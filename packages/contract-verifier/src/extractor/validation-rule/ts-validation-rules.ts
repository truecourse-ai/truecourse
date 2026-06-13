/**
 * JS/TS validation-rule extractor.
 *
 * Recognizes the GENERAL "required-when" guard shape — a branch that reads
 * a setting/entity field, optionally checks an actor/role, detects a
 * missing input, and throws (or returns an error):
 *
 *   if (eventType.requiresReason === 'MANDATORY' && actor === 'host' && !reason)
 *     throw new ValidationError('reason_required', ...);
 *
 * The shape is not specific to any feature, framework, or ORM. It is a
 * structural pattern:
 *
 *   if ( <setting-predicate> [&& <actor-predicate>] && <target-missing> )
 *     <throw | return-error>
 *
 * From it the extractor derives a ValidationRuleContract:
 *   - target   = the identifier in the missing-check (`!reason` → `reason`)
 *   - when     = the setting predicate as a typed `Predicate`
 *                (`eventType.requiresReason === 'MANDATORY'` → eq predicate)
 *   - actor    = the literal an actor/role identifier is compared to
 *   - effect   = `required` (the guard enforces presence)
 *   - onViolation = { status, errorCode } when derivable from the throw
 *
 * A guard with no recognizable missing-check or no setting predicate is
 * skipped — the extractor never invents a rule from an ambiguous branch.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type {
  LiteralValue,
  Predicate,
  QualifiedColumn,
  ValidationRuleContract,
} from '../../types/index.js';
import type { ExtractedValidationRule } from './types.js';

export function extractValidationRulesFromFile(
  filePath: string,
  _source: string,
  tree: Tree,
): ExtractedValidationRule[] {
  const out: ExtractedValidationRule[] = [];
  walk(tree.rootNode, (node) => {
    if (node.type !== 'if_statement') return true;
    const rule = extractFromIf(node, filePath);
    if (rule) out.push(rule);
    return true;
  });
  return out;
}

// ---------------------------------------------------------------------------
// if-statement → validation rule
// ---------------------------------------------------------------------------

function extractFromIf(
  ifNode: SyntaxNode,
  filePath: string,
): ExtractedValidationRule | null {
  const condNode = ifNode.childForFieldName('condition');
  const conseqNode = ifNode.childForFieldName('consequence');
  if (!condNode || !conseqNode) return null;

  // The consequence must enforce — throw or return an error. A pure
  // assignment/no-op branch is not a requiredness guard.
  const violation = findViolation(conseqNode);
  if (!violation.enforces) return null;

  // Flatten the `&&` conjunction in the condition into atomic comparisons.
  const conjuncts = flattenAnd(unwrapParens(condNode));

  let when: Predicate | undefined;
  let actor: string | undefined;
  let target: string | undefined;

  for (const c of conjuncts) {
    // target-missing: `!x`, `!x?.length`, `x == null`, `x === undefined`,
    // `x.length === 0`.
    const missing = matchMissing(c);
    if (missing && !target) {
      target = missing;
      continue;
    }
    // actor predicate: bare identifier compared to a string literal.
    const a = matchActor(c);
    if (a && !actor) {
      actor = a.value;
      continue;
    }
    // setting predicate: member-expression compared to a literal, or a
    // bare member-expression truthiness check.
    const p = matchSettingPredicate(c);
    if (p && !when) {
      when = p;
      continue;
    }
  }

  // A required-when rule needs at minimum a target to require and a
  // setting condition that gates it.
  if (!target || !when) return null;

  const contract: ValidationRuleContract = {
    target,
    when,
    effect: 'required',
    ...(actor ? { actor } : {}),
    ...(violation.onViolation ? { onViolation: violation.onViolation } : {}),
  };

  const settingCol = (when as { column?: QualifiedColumn }).column;
  const settingName = settingCol
    ? `${settingCol.table ? settingCol.table + '.' : ''}${settingCol.column}`
    : 'condition';

  return {
    identity: `${settingName}.required-when.${target}`,
    contract,
    source: {
      filePath,
      lineStart: ifNode.startPosition.row + 1,
      lineEnd: ifNode.endPosition.row + 1,
    },
  };
}

// ---------------------------------------------------------------------------
// Condition matchers
// ---------------------------------------------------------------------------

/** Recognize a member-expression compared to a literal → typed Predicate. */
function matchSettingPredicate(node: SyntaxNode): Predicate | null {
  if (node.type === 'binary_expression') {
    const left = node.childForFieldName('left');
    const op = node.childForFieldName('operator');
    const right = node.childForFieldName('right');
    if (!left || !op || !right) return null;
    if (left.type !== 'member_expression') return null;
    const col = memberToColumn(left);
    if (!col) return null;
    const lit = literalFromNode(right);
    const kind = compareKind(op.text, false);
    if (lit && kind) return { kind, column: col, value: lit } as Predicate;
    const kindInverse = compareKind(op.text, true);
    if (lit && kindInverse) return { kind: kindInverse, column: col, value: lit } as Predicate;
    return null;
  }
  // Bare truthiness on a member expression: `if (eventType.requiresReason && !reason)`
  // → the setting is true. Modelled as `eq <col> true`.
  if (node.type === 'member_expression') {
    const col = memberToColumn(node);
    if (col) return { kind: 'eq', column: col, value: { kind: 'boolean', value: true } };
  }
  return null;
}

/** Recognize a bare-identifier === string-literal actor/role check. */
function matchActor(node: SyntaxNode): { id: string; value: string } | null {
  if (node.type !== 'binary_expression') return null;
  const left = node.childForFieldName('left');
  const op = node.childForFieldName('operator');
  const right = node.childForFieldName('right');
  if (!left || !op || !right) return null;
  if (op.text !== '===' && op.text !== '==') return null;
  // Either side may hold the identifier; the other the literal.
  const pairs: Array<[SyntaxNode, SyntaxNode]> = [
    [left, right],
    [right, left],
  ];
  for (const [idNode, litNode] of pairs) {
    if (idNode.type === 'identifier' && litNode.type === 'string') {
      return { id: idNode.text, value: stringText(litNode) };
    }
    // `ctx.user.role === 'host'` — a member-expression whose property is a
    // role-ish name also counts as an actor check.
    if (idNode.type === 'member_expression' && litNode.type === 'string') {
      const prop = idNode.childForFieldName('property');
      if (prop && /^(role|actor|userType|kind|type)$/i.test(prop.text)) {
        return { id: prop.text, value: stringText(litNode) };
      }
    }
  }
  return null;
}

/** Recognize a target-missing check; returns the missing identifier name. */
function matchMissing(node: SyntaxNode): string | null {
  // `!x` or `!x?.length` / `!x.trim()`
  if (node.type === 'unary_expression') {
    const opNode = node.children[0];
    const arg = node.namedChild(0);
    if (!opNode || opNode.text !== '!' || !arg) return null;
    return rootIdentifier(arg);
  }
  // `x == null` / `x === undefined` / `x === null` / `x == undefined`
  if (node.type === 'binary_expression') {
    const left = node.childForFieldName('left');
    const op = node.childForFieldName('operator');
    const right = node.childForFieldName('right');
    if (!left || !op || !right) return null;
    if (op.text !== '==' && op.text !== '===') return null;
    const isNullish = (n: SyntaxNode): boolean =>
      n.type === 'null' || (n.type === 'identifier' && n.text === 'undefined');
    // `x.length === 0` — empty string/array missing-check.
    if (
      left.type === 'member_expression' &&
      left.childForFieldName('property')?.text === 'length' &&
      right.type === 'number' &&
      right.text === '0'
    ) {
      const obj = left.childForFieldName('object');
      return obj ? rootIdentifier(obj) : null;
    }
    if (isNullish(right)) return rootIdentifier(left);
    if (isNullish(left)) return rootIdentifier(right);
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

/**
 * Inspect the consequence block. It "enforces" when it throws, or returns
 * something that looks like an error (an object/identifier with an error
 * code or a non-2xx status). Pull out status + errorCode when present.
 */
function findViolation(conseq: SyntaxNode): Violation {
  let result: Violation = { enforces: false };
  walk(conseq, (n) => {
    if (n.type === 'throw_statement') {
      result = { enforces: true, onViolation: violationFromThrow(n) };
      return false;
    }
    if (n.type === 'return_statement') {
      const v = violationFromReturn(n);
      if (v) result = { enforces: true, onViolation: v.onViolation };
      return false;
    }
    return true;
  });
  return result;
}

function violationFromThrow(throwNode: SyntaxNode): { status: number; errorCode: string } | undefined {
  // `throw new ValidationError('reason_required', ...)` /
  // `throw new HttpError(400, 'reason_required')`
  const expr = throwNode.namedChild(0);
  if (!expr || expr.type !== 'new_expression') return undefined;
  const args = expr.childForFieldName('arguments');
  if (!args) return undefined;
  return statusAndCodeFromArgs(args);
}

function violationFromReturn(
  returnNode: SyntaxNode,
): { onViolation?: { status: number; errorCode: string } } | null {
  const arg = returnNode.namedChild(0);
  if (!arg) return null;
  // `return { error: 'reason_required', status: 400 }` /
  // `return res.status(400).json({ code: 'reason_required' })`
  let status = 0;
  let errorCode = '';
  walk(arg, (n) => {
    if (n.type === 'pair') {
      const key = n.childForFieldName('key')?.text ?? '';
      const value = n.childForFieldName('value');
      if (!value) return true;
      if (/^(status|statusCode|httpStatus)$/i.test(key) && value.type === 'number') {
        status = parseInt(value.text, 10);
      }
      if (/^(error|errorCode|code|message)$/i.test(key) && value.type === 'string') {
        if (!errorCode) errorCode = stringText(value);
      }
    }
    // `res.status(400)`
    if (n.type === 'call_expression') {
      const fn = n.childForFieldName('function');
      if (fn?.type === 'member_expression' && fn.childForFieldName('property')?.text === 'status') {
        const a = n.childForFieldName('arguments')?.namedChild(0);
        if (a?.type === 'number') status = parseInt(a.text, 10);
      }
    }
    return true;
  });
  // Only treat a return as enforcement when it carries an error signal.
  if (status === 0 && errorCode === '') return null;
  if (status !== 0 && status < 400) return null;
  return { onViolation: { status: status || 400, errorCode } };
}

/** First numeric arg → status; first string arg → errorCode. */
function statusAndCodeFromArgs(
  args: SyntaxNode,
): { status: number; errorCode: string } | undefined {
  let status = 0;
  let errorCode = '';
  for (let i = 0; i < args.namedChildCount; i++) {
    const a = args.namedChild(i);
    if (!a) continue;
    if (a.type === 'number' && status === 0) status = parseInt(a.text, 10);
    else if (a.type === 'string' && errorCode === '') errorCode = stringText(a);
  }
  if (status === 0 && errorCode === '') return undefined;
  return { status: status || 400, errorCode };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unwrapParens(node: SyntaxNode): SyntaxNode {
  let n = node;
  while (n.type === 'parenthesized_expression') {
    const inner = n.namedChild(0);
    if (!inner) break;
    n = inner;
  }
  return n;
}

/** Flatten left-associated `a && b && c` into [a, b, c]. */
function flattenAnd(node: SyntaxNode): SyntaxNode[] {
  const n = unwrapParens(node);
  if (n.type === 'binary_expression' && n.childForFieldName('operator')?.text === '&&') {
    const left = n.childForFieldName('left');
    const right = n.childForFieldName('right');
    const out: SyntaxNode[] = [];
    if (left) out.push(...flattenAnd(left));
    if (right) out.push(...flattenAnd(right));
    return out;
  }
  return [n];
}

/** `eventType.requiresReason` → { table: 'eventType', column: 'requiresReason' }. */
function memberToColumn(member: SyntaxNode): QualifiedColumn | null {
  const obj = member.childForFieldName('object');
  const prop = member.childForFieldName('property');
  if (!prop || prop.type !== 'property_identifier') return null;
  const column = prop.text;
  if (!obj) return { column };
  // `a.b.c` — keep the full dotted object path as the table so the spec's
  // `table.column` form matches.
  const objPath = dottedPath(obj);
  return objPath ? { table: objPath, column } : { column };
}

/** Dotted path of a (possibly nested) member-expression / identifier. */
function dottedPath(node: SyntaxNode): string | null {
  if (node.type === 'identifier' || node.type === 'this') return node.text;
  if (node.type === 'member_expression') {
    const obj = node.childForFieldName('object');
    const prop = node.childForFieldName('property');
    if (!obj || !prop) return null;
    const base = dottedPath(obj);
    return base ? `${base}.${prop.text}` : prop.text;
  }
  return null;
}

/** Root identifier of an expression (`reason`, `body.reason` → `reason`/`body`). */
function rootIdentifier(node: SyntaxNode): string | null {
  if (node.type === 'identifier') return node.text;
  if (node.type === 'member_expression' || node.type === 'subscript_expression') {
    const prop = node.childForFieldName('property');
    if (prop && prop.type === 'property_identifier') return prop.text;
    const obj = node.childForFieldName('object');
    return obj ? rootIdentifier(obj) : null;
  }
  // `reason?.length` / `reason.trim()` — descend into the call/optional chain.
  if (node.type === 'call_expression') {
    const fn = node.childForFieldName('function');
    return fn ? rootIdentifier(fn) : null;
  }
  return null;
}

function compareKind(
  op: string,
  inverse: boolean,
): Extract<Predicate, { value: LiteralValue }>['kind'] | null {
  if (inverse) {
    switch (op) {
      case '!==':
      case '!=':
        return 'neq';
      default:
        return null;
    }
  }
  switch (op) {
    case '===':
    case '==':
      return 'eq';
    case '>':
      return 'gt';
    case '>=':
      return 'gte';
    case '<':
      return 'lt';
    case '<=':
      return 'lte';
    default:
      return null;
  }
}

function literalFromNode(node: SyntaxNode): LiteralValue | null {
  switch (node.type) {
    case 'string':
      return { kind: 'string', value: stringText(node) };
    case 'number': {
      const n = parseFloat(node.text);
      return Number.isNaN(n) ? null : { kind: 'number', value: n };
    }
    case 'true':
      return { kind: 'boolean', value: true };
    case 'false':
      return { kind: 'boolean', value: false };
    case 'null':
      return { kind: 'null' };
    default:
      return null;
  }
}

function stringText(node: SyntaxNode): string {
  const frag = node.namedChild(0);
  if (frag && frag.type === 'string_fragment') return frag.text;
  // Empty string literal has no fragment child.
  const raw = node.text;
  return raw.length >= 2 ? raw.slice(1, -1) : raw;
}

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => boolean | void): void {
  const recurse = visit(node);
  if (recurse === false) return;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) walk(c, visit);
  }
}
