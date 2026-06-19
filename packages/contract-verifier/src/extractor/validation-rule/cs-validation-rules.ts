/**
 * C# validation-rule extractor — the language-general twin of
 * `ts-validation-rules.ts` / `py-validation-rules.ts`. Recognizes the same
 * "required-when" guard shape, in C# syntax:
 *
 *   if (eventType.RequiresReason && actor == "host" && string.IsNullOrEmpty(reason))
 *       throw new ValidationException("reason_required");
 *
 * Structural pattern (framework/ORM-agnostic):
 *
 *   if ( <setting-predicate> [&& <actor-predicate>] && <target-missing> )
 *       <throw | return-error>
 *
 * → ValidationRuleContract { target, when: Predicate, effect: 'required',
 *   actor?, onViolation? }. A guard with no recognizable missing-check or no
 * setting predicate is skipped.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type {
  LiteralValue,
  Predicate,
  QualifiedColumn,
  ValidationRuleContract,
} from '../../types/index.js';
import type { ExtractedValidationRule } from './types.js';
import { walkCs, sliceNode, csStringText } from '../shared/cs-nodes.js';

const MISSING_HELPERS = /^(IsNullOrEmpty|IsNullOrWhiteSpace)$/;

export function extractCsValidationRulesFromFile(
  filePath: string,
  source: string,
  tree: Tree,
): ExtractedValidationRule[] {
  const out: ExtractedValidationRule[] = [];
  walkCs(tree.rootNode, (node) => {
    if (node.type !== 'if_statement') return;
    const rule = extractFromIf(node, source, filePath);
    if (rule) out.push(rule);
  });
  return out;
}

function extractFromIf(ifNode: SyntaxNode, source: string, filePath: string): ExtractedValidationRule | null {
  const condNode = ifNode.childForFieldName('condition');
  const conseqNode = ifNode.childForFieldName('consequence');
  if (!condNode || !conseqNode) return null;

  const violation = findViolation(conseqNode, source);
  if (!violation.enforces) return null;

  const conjuncts = flattenAnd(condNode, source);

  let when: Predicate | undefined;
  let actor: string | undefined;
  let target: string | undefined;

  for (const c of conjuncts) {
    const missing = matchMissing(c, source);
    if (missing && !target) { target = missing; continue; }
    const a = matchActor(c, source);
    if (a && !actor) { actor = a; continue; }
    const p = matchSettingPredicate(c, source);
    if (p && !when) { when = p; continue; }
  }

  if (!target || !when) return null;

  const contract: ValidationRuleContract = {
    target,
    when,
    effect: 'required',
    ...(actor ? { actor } : {}),
    ...(violation.onViolation ? { onViolation: violation.onViolation } : {}),
  };

  const col = (when as { column?: QualifiedColumn }).column;
  const settingName = col ? `${col.table ? col.table + '.' : ''}${col.column}` : 'condition';

  return {
    identity: `${settingName}.required-when.${target}`,
    contract,
    source: { filePath, lineStart: ifNode.startPosition.row + 1, lineEnd: ifNode.endPosition.row + 1 },
  };
}

// ---------------------------------------------------------------------------
// Condition matchers
// ---------------------------------------------------------------------------

/** Member-access compared to a literal → Predicate; bare member-access
 *  truthiness → `eq <col> true`. */
function matchSettingPredicate(node: SyntaxNode, source: string): Predicate | null {
  if (node.type === 'binary_expression') {
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    if (!left || !right || left.type !== 'member_access_expression') return null;
    const col = memberToColumn(left, source);
    if (!col) return null;
    const lit = literalFromNode(right, source);
    if (!lit) return null;
    const op = opText(node, source) ?? '';
    const kind = compareKind(op, false) ?? compareKind(op, true);
    return kind ? ({ kind, column: col, value: lit } as Predicate) : null;
  }
  if (node.type === 'member_access_expression') {
    const col = memberToColumn(node, source);
    if (col) return { kind: 'eq', column: col, value: { kind: 'boolean', value: true } };
  }
  return null;
}

/** Bare-identifier (or role-ish member) `== "literal"` actor check → the literal. */
function matchActor(node: SyntaxNode, source: string): string | null {
  if (node.type !== 'binary_expression') return null;
  const op = opText(node, source);
  if (op !== '==' && op !== '!=') return null;
  const left = node.childForFieldName('left');
  const right = node.childForFieldName('right');
  if (!left || !right) return null;
  for (const [idNode, litNode] of [[left, right], [right, left]] as Array<[SyntaxNode, SyntaxNode]>) {
    if (!litNode.type.endsWith('string_literal')) continue;
    if (idNode.type === 'identifier') return csStringText(litNode, source) ?? '';
    if (idNode.type === 'member_access_expression') {
      const prop = idNode.childForFieldName('name');
      if (prop && /^(role|actor|userType|kind|type)$/i.test(sliceNode(prop, source))) {
        return csStringText(litNode, source) ?? '';
      }
    }
  }
  return null;
}

/** Target-missing check → the missing field name. */
function matchMissing(node: SyntaxNode, source: string): string | null {
  // string.IsNullOrEmpty(x) / string.IsNullOrWhiteSpace(x)
  if (node.type === 'invocation_expression') {
    const fn = node.childForFieldName('function');
    if (fn?.type !== 'member_access_expression') return null;
    const name = fn.childForFieldName('name');
    if (!name || !MISSING_HELPERS.test(sliceNode(name, source))) return null;
    const arg = firstArgExpr(node);
    return arg ? rootIdentifier(arg, source) : null;
  }
  // x == null / x.Length == 0
  if (node.type === 'binary_expression') {
    if (opText(node, source) !== '==') return null;
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    if (!left || !right) return null;
    // x.Length == 0
    if (
      left.type === 'member_access_expression' &&
      sliceNode(left.childForFieldName('name') ?? left, source) === 'Length' &&
      right.type === 'integer_literal' && sliceNode(right, source) === '0'
    ) {
      const obj = left.childForFieldName('expression');
      return obj ? rootIdentifier(obj, source) : null;
    }
    if (right.type === 'null_literal') return rootIdentifier(left, source);
    if (left.type === 'null_literal') return rootIdentifier(right, source);
    return null;
  }
  // x is null
  if (node.type === 'is_pattern_expression') {
    const expr = node.childForFieldName('expression');
    const pattern = node.childForFieldName('pattern');
    if (expr && pattern?.type === 'constant_pattern' && pattern.namedChild(0)?.type === 'null_literal') {
      return rootIdentifier(expr, source);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Violation (throw / return-error) detection
// ---------------------------------------------------------------------------

interface Violation {
  enforces: boolean;
  onViolation?: { status: number; errorCode: string };
}

function findViolation(conseq: SyntaxNode, source: string): Violation {
  let result: Violation = { enforces: false };
  walkCs(conseq, (n) => {
    if (result.enforces) return;
    if (n.type === 'throw_statement') {
      const expr = n.namedChild(0);
      const args = expr?.type === 'object_creation_expression' ? expr.childForFieldName('arguments') : null;
      result = { enforces: true, onViolation: args ? statusAndCode(args, source) : undefined };
    } else if (n.type === 'return_statement') {
      const v = violationFromReturn(n, source);
      if (v) result = { enforces: true, onViolation: v };
    }
  });
  return result;
}

function violationFromReturn(returnNode: SyntaxNode, source: string): { status: number; errorCode: string } | null {
  let status = 0;
  let errorCode = '';
  walkCs(returnNode, (n) => {
    // `return BadRequest(new { error = "reason_required" })` / `StatusCode(400, …)`
    if (n.type === 'assignment_expression') {
      const left = n.childForFieldName('left');
      const right = n.childForFieldName('right');
      if (!left || !right) return;
      const key = sliceNode(left, source);
      if (/^(status|statusCode|httpStatus)$/i.test(key) && right.type === 'integer_literal') {
        status = parseInt(sliceNode(right, source), 10);
      } else if (/^(error|errorCode|code|message)$/i.test(key) && right.type.endsWith('string_literal') && !errorCode) {
        errorCode = csStringText(right, source) ?? '';
      }
    }
    if (n.type === 'invocation_expression') {
      const fn = n.childForFieldName('function');
      const name = fn?.type === 'identifier' ? sliceNode(fn, source)
        : fn?.type === 'member_access_expression' ? sliceNode(fn.childForFieldName('name') ?? fn, source) : '';
      if (name === 'StatusCode') {
        const a = firstArgExpr(n);
        if (a?.type === 'integer_literal') status = parseInt(sliceNode(a, source), 10);
      } else if (/^BadRequest$/.test(name) && status === 0) {
        status = 400;
      }
    }
  });
  if (status === 0 && errorCode === '') return null;
  if (status !== 0 && status < 400) return null;
  return { status: status || 400, errorCode };
}

/** First numeric arg → status; first string arg → errorCode. */
function statusAndCode(args: SyntaxNode, source: string): { status: number; errorCode: string } | undefined {
  let status = 0;
  let errorCode = '';
  for (let i = 0; i < args.namedChildCount; i++) {
    const arg = args.namedChild(i);
    const a = arg?.type === 'argument' ? arg.namedChild(0) : arg;
    if (!a) continue;
    if (a.type === 'integer_literal' && status === 0) status = parseInt(sliceNode(a, source), 10);
    else if (a.type.endsWith('string_literal') && errorCode === '') errorCode = csStringText(a, source) ?? '';
  }
  if (status === 0 && errorCode === '') return undefined;
  return { status: status || 400, errorCode };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flatten left-associated `a && b && c` into [a, b, c]. */
function flattenAnd(node: SyntaxNode, source: string): SyntaxNode[] {
  if (node.type === 'binary_expression' && opText(node, source) === '&&') {
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    const out: SyntaxNode[] = [];
    if (left) out.push(...flattenAnd(left, source));
    if (right) out.push(...flattenAnd(right, source));
    return out;
  }
  return [node];
}

function opText(node: SyntaxNode, source: string): string | null {
  const op = node.childForFieldName('operator');
  if (op) return sliceNode(op, source);
  const left = node.childForFieldName('left');
  const right = node.childForFieldName('right');
  if (left && right) return source.slice(left.endIndex, right.startIndex).trim();
  return null;
}

function firstArgExpr(call: SyntaxNode): SyntaxNode | null {
  const args = call.childForFieldName('arguments');
  const arg = args?.namedChild(0);
  if (!arg) return null;
  return arg.type === 'argument' ? arg.namedChild(0) : arg;
}

/** `eventType.RequiresReason` → { table: 'eventType', column: 'RequiresReason' }. */
function memberToColumn(member: SyntaxNode, source: string): QualifiedColumn | null {
  const name = member.childForFieldName('name');
  if (!name) return null;
  const column = sliceNode(name, source);
  const obj = member.childForFieldName('expression');
  const objPath = obj ? dottedPath(obj, source) : null;
  return objPath ? { table: objPath, column } : { column };
}

function dottedPath(node: SyntaxNode, source: string): string | null {
  if (node.type === 'identifier' || node.type === 'this_expression') return sliceNode(node, source);
  if (node.type === 'member_access_expression') {
    const obj = node.childForFieldName('expression');
    const name = node.childForFieldName('name');
    if (!name) return null;
    const base = obj ? dottedPath(obj, source) : null;
    return base ? `${base}.${sliceNode(name, source)}` : sliceNode(name, source);
  }
  return null;
}

/** Root field of an expression (`reason`, `input.Reason` → `reason`/`Reason`). */
function rootIdentifier(node: SyntaxNode, source: string): string | null {
  if (node.type === 'identifier') return sliceNode(node, source);
  if (node.type === 'member_access_expression') {
    const name = node.childForFieldName('name');
    if (name) return sliceNode(name, source);
    const obj = node.childForFieldName('expression');
    return obj ? rootIdentifier(obj, source) : null;
  }
  if (node.type === 'invocation_expression') {
    const fn = node.childForFieldName('function');
    return fn ? rootIdentifier(fn, source) : null;
  }
  return null;
}

function compareKind(op: string, inverse: boolean): Extract<Predicate, { value: LiteralValue }>['kind'] | null {
  if (inverse) return op === '!=' ? 'neq' : null;
  switch (op) {
    case '==': return 'eq';
    case '>': return 'gt';
    case '>=': return 'gte';
    case '<': return 'lt';
    case '<=': return 'lte';
    default: return null;
  }
}

function literalFromNode(node: SyntaxNode, source: string): LiteralValue | null {
  switch (node.type) {
    case 'string_literal':
    case 'verbatim_string_literal':
    case 'raw_string_literal':
      return { kind: 'string', value: csStringText(node, source) ?? '' };
    case 'integer_literal': {
      const n = parseInt(sliceNode(node, source).replace(/[_lLuU]/g, ''), 10);
      return Number.isNaN(n) ? null : { kind: 'number', value: n };
    }
    case 'real_literal': {
      const n = parseFloat(sliceNode(node, source).replace(/[_fFdDmM]/g, ''));
      return Number.isNaN(n) ? null : { kind: 'number', value: n };
    }
    case 'boolean_literal':
      return { kind: 'boolean', value: sliceNode(node, source) === 'true' };
    case 'null_literal':
      return { kind: 'null' };
    default:
      return null;
  }
}
