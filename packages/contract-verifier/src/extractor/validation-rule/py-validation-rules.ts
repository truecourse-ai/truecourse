/**
 * Python validation-rule extractor — the language-general twin of
 * `ts-validation-rules.ts`. Recognizes the same "required-when" guard shape,
 * expressed in Python syntax:
 *
 *   if customer.loyalty_tier == "gold" and actor == "customer" and not reason:
 *       raise ValidationError(400, "reason_required")
 *
 * The structural pattern is identical across languages:
 *
 *   if ( <setting-predicate> [and <actor-predicate>] and <target-missing> ):
 *       <raise | return-error>
 *
 * and it yields the same `ValidationRuleContract`:
 *   - target   = the identifier in the missing-check (`not reason` → `reason`)
 *   - when     = the setting predicate as a typed `Predicate`
 *   - actor    = the literal an actor/role identifier is compared to
 *   - effect   = `required`
 *   - onViolation = { status, errorCode } when derivable from the raise
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

export function extractPyValidationRulesFromFile(
  filePath: string,
  source: string,
  tree: Tree,
): ExtractedValidationRule[] {
  const out: ExtractedValidationRule[] = [];
  walk(tree.rootNode, (node) => {
    if (node.type !== 'if_statement') return true;
    const rule = extractFromIf(node, source, filePath);
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
  source: string,
  filePath: string,
): ExtractedValidationRule | null {
  const condNode = ifNode.childForFieldName('condition');
  const conseqNode = ifNode.childForFieldName('consequence');
  if (!condNode || !conseqNode) return null;

  // The body must enforce — raise or return an error. A pure assignment /
  // pass branch is not a requiredness guard.
  const violation = findViolation(conseqNode, source);
  if (!violation.enforces) return null;

  // Flatten the `and` conjunction into atomic comparisons.
  const conjuncts = flattenAnd(condNode);

  let when: Predicate | undefined;
  let actor: string | undefined;
  let target: string | undefined;

  for (const c of conjuncts) {
    // target-missing: `not x`, `x is None`, `x == None`, `x == ""`,
    // `len(x) == 0`.
    const missing = matchMissing(c, source);
    if (missing && !target) {
      target = missing;
      continue;
    }
    // actor predicate: a bare identifier compared to a string literal.
    const a = matchActor(c, source);
    if (a && !actor) {
      actor = a.value;
      continue;
    }
    // setting predicate: attribute compared to a literal, or a bare
    // attribute truthiness check.
    const p = matchSettingPredicate(c, source);
    if (p && !when) {
      when = p;
      continue;
    }
  }

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

/** Recognize an attribute compared to a literal → typed Predicate. */
function matchSettingPredicate(node: SyntaxNode, source: string): Predicate | null {
  if (node.type === 'comparison_operator') {
    const cmp = readComparison(node);
    if (!cmp) return null;
    if (cmp.left.type !== 'attribute') return null;
    const col = attributeToColumn(cmp.left, source);
    if (!col) return null;
    const lit = literalFromNode(cmp.right, source);
    if (!lit) return null;
    const kind = compareKind(cmp.op);
    if (kind) return { kind, column: col, value: lit } as Predicate;
    return null;
  }
  // Bare attribute truthiness: `if customer.requires_reason and not reason:`
  // → the setting is true. Modelled as `eq <col> true`.
  if (node.type === 'attribute') {
    const col = attributeToColumn(node, source);
    if (col) return { kind: 'eq', column: col, value: { kind: 'boolean', value: true } };
  }
  return null;
}

/** Recognize a bare-identifier == string-literal actor/role check. */
function matchActor(node: SyntaxNode, source: string): { id: string; value: string } | null {
  if (node.type !== 'comparison_operator') return null;
  const cmp = readComparison(node);
  if (!cmp || (cmp.op !== '==' && cmp.op !== 'is')) return null;
  // Either side may hold the identifier; the other the literal.
  const pairs: Array<[SyntaxNode, SyntaxNode]> = [
    [cmp.left, cmp.right],
    [cmp.right, cmp.left],
  ];
  for (const [idNode, litNode] of pairs) {
    if (idNode.type === 'identifier' && litNode.type === 'string') {
      return { id: text(idNode, source), value: stringText(litNode, source) };
    }
    // `ctx.user.role == "host"` — an attribute whose property is a role-ish
    // name also counts as an actor check.
    if (idNode.type === 'attribute' && litNode.type === 'string') {
      const prop = idNode.childForFieldName('attribute');
      if (prop && /^(role|actor|user_type|userType|kind|type)$/i.test(text(prop, source))) {
        return { id: text(prop, source), value: stringText(litNode, source) };
      }
    }
  }
  return null;
}

/** Recognize a target-missing check; returns the missing identifier name. */
function matchMissing(node: SyntaxNode, source: string): string | null {
  // `not x` / `not x.strip()`
  if (node.type === 'not_operator') {
    const arg = node.childForFieldName('argument') ?? node.namedChild(0);
    return arg ? rootIdentifier(arg, source) : null;
  }
  // `x is None` / `x == None` / `x == ""` / `len(x) == 0`
  if (node.type === 'comparison_operator') {
    const cmp = readComparison(node);
    if (!cmp) return null;
    if (cmp.op !== '==' && cmp.op !== 'is') return null;
    const isNone = (n: SyntaxNode): boolean => n.type === 'none';
    const isEmptyStr = (n: SyntaxNode): boolean => n.type === 'string' && stringText(n, source) === '';
    // `len(x) == 0` — empty string/collection missing-check.
    if (isCallTo(cmp.left, 'len', source) && cmp.right.type === 'integer' && text(cmp.right, source) === '0') {
      const arg = cmp.left.childForFieldName('arguments')?.namedChild(0);
      return arg ? rootIdentifier(arg, source) : null;
    }
    if (isNone(cmp.right) || isEmptyStr(cmp.right)) return rootIdentifier(cmp.left, source);
    if (isNone(cmp.left) || isEmptyStr(cmp.left)) return rootIdentifier(cmp.right, source);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Violation (raise / return-error) detection
// ---------------------------------------------------------------------------

interface Violation {
  enforces: boolean;
  onViolation?: { status: number; errorCode: string };
}

/**
 * Inspect the consequence block. It "enforces" when it raises, or returns
 * something that looks like an error (a dict/call with an error code or a
 * non-2xx status). Pull out status + errorCode when present.
 */
function findViolation(conseq: SyntaxNode, source: string): Violation {
  let result: Violation = { enforces: false };
  walk(conseq, (n) => {
    if (n.type === 'raise_statement') {
      result = { enforces: true, onViolation: violationFromRaise(n, source) };
      return false;
    }
    if (n.type === 'return_statement') {
      const v = violationFromReturn(n, source);
      if (v) result = { enforces: true, onViolation: v.onViolation };
      return false;
    }
    return true;
  });
  return result;
}

function violationFromRaise(
  raiseNode: SyntaxNode,
  source: string,
): { status: number; errorCode: string } | undefined {
  // `raise ValidationError(400, "reason_required")` /
  // `raise HTTPException(status_code=422, detail="reason_required")`
  let call: SyntaxNode | null = null;
  walk(raiseNode, (n) => {
    if (n.type === 'call') {
      call = n;
      return false;
    }
    return true;
  });
  if (!call) return undefined;
  const args = (call as SyntaxNode).childForFieldName('arguments');
  if (!args) return undefined;
  return statusAndCodeFromArgs(args, source);
}

function violationFromReturn(
  returnNode: SyntaxNode,
  source: string,
): { onViolation?: { status: number; errorCode: string } } | null {
  const arg = returnNode.namedChild(0);
  if (!arg) return null;
  // `return {"error": "reason_required", "status": 400}`
  let status = 0;
  let errorCode = '';
  walk(arg, (n) => {
    if (n.type === 'pair') {
      const keyNode = n.childForFieldName('key');
      const value = n.childForFieldName('value');
      if (!keyNode || !value) return true;
      const key = keyNode.type === 'string' ? stringText(keyNode, source) : text(keyNode, source);
      if (/^(status|status_code|http_status)$/i.test(key) && value.type === 'integer') {
        status = parseInt(text(value, source), 10);
      }
      if (/^(error|error_code|code|message)$/i.test(key) && value.type === 'string') {
        if (!errorCode) errorCode = stringText(value, source);
      }
    }
    return true;
  });
  if (status === 0 && errorCode === '') return null;
  if (status !== 0 && status < 400) return null;
  return { onViolation: { status: status || 400, errorCode } };
}

/**
 * First numeric arg (positional or keyword) → status; first string arg →
 * errorCode. Handles `(400, "code")`, `(status_code=400, detail="code")`.
 */
function statusAndCodeFromArgs(
  args: SyntaxNode,
  source: string,
): { status: number; errorCode: string } | undefined {
  let status = 0;
  let errorCode = '';
  const consider = (n: SyntaxNode): void => {
    if (n.type === 'integer' && status === 0) status = parseInt(text(n, source), 10);
    else if (n.type === 'string' && errorCode === '') errorCode = stringText(n, source);
  };
  for (let i = 0; i < args.namedChildCount; i++) {
    const a = args.namedChild(i);
    if (!a) continue;
    if (a.type === 'keyword_argument') {
      const v = a.childForFieldName('value');
      if (v) consider(v);
    } else {
      consider(a);
    }
  }
  if (status === 0 && errorCode === '') return undefined;
  return { status: status || 400, errorCode };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Comparison {
  left: SyntaxNode;
  op: string;
  right: SyntaxNode;
}

/**
 * Read a Python `comparison_operator` into (left, op, right). The operator
 * is an unnamed token child (`==`, `is`, `is not`, `>`, …) sitting between
 * the two named operands.
 */
function readComparison(node: SyntaxNode): Comparison | null {
  const left = node.namedChild(0);
  const right = node.namedChild(1);
  if (!left || !right) return null;
  let op = '';
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && !c.isNamed) {
      op = c.type;
      break;
    }
  }
  if (!op) return null;
  return { left, op, right };
}

/** Flatten left-associated `a and b and c` into [a, b, c]. */
function flattenAnd(node: SyntaxNode): SyntaxNode[] {
  if (node.type === 'parenthesized_expression') {
    const inner = node.namedChild(0);
    return inner ? flattenAnd(inner) : [node];
  }
  if (node.type === 'boolean_operator' && node.childForFieldName('operator')?.type === 'and') {
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    const out: SyntaxNode[] = [];
    if (left) out.push(...flattenAnd(left));
    if (right) out.push(...flattenAnd(right));
    return out;
  }
  return [node];
}

/** `customer.loyalty_tier` → { table: 'customer', column: 'loyalty_tier' }. */
function attributeToColumn(attr: SyntaxNode, source: string): QualifiedColumn | null {
  const prop = attr.childForFieldName('attribute');
  if (!prop) return null;
  const column = text(prop, source);
  const obj = attr.childForFieldName('object');
  if (!obj) return { column };
  const objPath = dottedPath(obj, source);
  return objPath ? { table: objPath, column } : { column };
}

/** Dotted path of a (possibly nested) attribute / identifier. */
function dottedPath(node: SyntaxNode, source: string): string | null {
  if (node.type === 'identifier') return text(node, source);
  if (node.type === 'attribute') {
    const obj = node.childForFieldName('object');
    const prop = node.childForFieldName('attribute');
    if (!obj || !prop) return null;
    const base = dottedPath(obj, source);
    return base ? `${base}.${text(prop, source)}` : text(prop, source);
  }
  return null;
}

/** Root identifier of an expression (`reason` / `body.reason` → `reason`). */
function rootIdentifier(node: SyntaxNode, source: string): string | null {
  if (node.type === 'identifier') return text(node, source);
  if (node.type === 'attribute' || node.type === 'subscript') {
    const prop = node.childForFieldName('attribute');
    if (prop) return text(prop, source);
    const obj = node.childForFieldName('object') ?? node.childForFieldName('value');
    return obj ? rootIdentifier(obj, source) : null;
  }
  // `reason.strip()` — descend into the call's function attribute chain.
  if (node.type === 'call') {
    const fn = node.childForFieldName('function');
    return fn ? rootIdentifier(fn, source) : null;
  }
  return null;
}

function isCallTo(node: SyntaxNode, name: string, source: string): boolean {
  if (node.type !== 'call') return false;
  const fn = node.childForFieldName('function');
  return !!fn && fn.type === 'identifier' && text(fn, source) === name;
}

function compareKind(op: string): Extract<Predicate, { value: LiteralValue }>['kind'] | null {
  switch (op) {
    case '==':
    case 'is':
      return 'eq';
    case '!=':
      return 'neq';
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

function literalFromNode(node: SyntaxNode, source: string): LiteralValue | null {
  switch (node.type) {
    case 'string':
      return { kind: 'string', value: stringText(node, source) };
    case 'integer': {
      const n = parseInt(text(node, source).replace(/_/g, ''), 10);
      return Number.isNaN(n) ? null : { kind: 'number', value: n };
    }
    case 'float': {
      const n = parseFloat(text(node, source).replace(/_/g, ''));
      return Number.isNaN(n) ? null : { kind: 'number', value: n };
    }
    case 'true':
      return { kind: 'boolean', value: true };
    case 'false':
      return { kind: 'boolean', value: false };
    case 'none':
      return { kind: 'null' };
    default:
      return null;
  }
}

function text(node: SyntaxNode, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}

function stringText(node: SyntaxNode, source: string): string {
  let content = '';
  let saw = false;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c?.type === 'string_content') {
      content += source.slice(c.startIndex, c.endIndex);
      saw = true;
    } else if (c?.type === 'interpolation') {
      return source.slice(node.startIndex, node.endIndex);
    }
  }
  if (saw) return content;
  const raw = source.slice(node.startIndex, node.endIndex);
  const m = raw.match(/^[a-zA-Z]*('''|"""|'|")([\s\S]*)\1$/);
  return m ? m[2] : raw;
}

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => boolean | void): void {
  const recurse = visit(node);
  if (recurse === false) return;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) walk(c, visit);
  }
}
