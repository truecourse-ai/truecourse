/**
 * JS/TS fallback extractor.
 *
 * Recognizes the GENERAL "null/absent → default" RUNTIME coalescing shape —
 * code that substitutes a value when a target is missing, at read/use time
 * (as opposed to a schema/DB column default). Three structural patterns,
 * none specific to any feature, framework, or ORM:
 *
 *   1. Nullish coalescing:   `x ?? DEFAULT`           (also `const v = x ?? DEFAULT`)
 *   2. Default parameter:    `function f(x = DEFAULT)`
 *   3. Guarded assignment:   `if (x == null) x = DEFAULT;`
 *
 * From each it derives a FallbackContract:
 *   - target       = the coalesced field/input (`x`, `obj.field` → field `field`)
 *   - trigger      = absent | null | null-or-absent (from the construct/operator)
 *   - defaultValue = the substituted literal/identifier (QueryRule LiteralValue)
 *
 * A site whose default is a complex expression (call, object/array literal,
 * another `??`) is skipped — the extractor never invents a scalar default
 * from a non-scalar coalescing, and an empty `= {}` / `= []` parameter
 * default is container plumbing, not a value fallback.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { FallbackContract, LiteralValue } from '../../types/index.js';
import type { ExtractedFallback } from './types.js';

export function extractFallbacksFromFile(
  filePath: string,
  _source: string,
  tree: Tree,
): ExtractedFallback[] {
  const out: ExtractedFallback[] = [];
  walk(tree.rootNode, (node) => {
    let fb: ExtractedFallback | null = null;
    if (node.type === 'binary_expression') fb = fromNullish(node, filePath);
    else if (node.type === 'required_parameter' || node.type === 'optional_parameter') {
      fb = fromDefaultParam(node, filePath);
    } else if (node.type === 'if_statement') fb = fromGuardedAssign(node, filePath);
    if (fb) out.push(fb);
    return true;
  });
  return out;
}

// ---------------------------------------------------------------------------
// 1. Nullish coalescing — `x ?? DEFAULT`
// ---------------------------------------------------------------------------

function fromNullish(node: SyntaxNode, filePath: string): ExtractedFallback | null {
  const op = node.childForFieldName('operator');
  if (!op || op.text !== '??') return null;
  const left = node.childForFieldName('left');
  const right = node.childForFieldName('right');
  if (!left || !right) return null;

  const field = targetField(left);
  if (!field) return null;
  const value = scalarLiteral(right);
  if (!value) return null;

  // `??` fires on either null or undefined — the nullish case.
  return build(field, 'null-or-absent', value, node, filePath);
}

// ---------------------------------------------------------------------------
// 2. Default parameter — `function f(x = DEFAULT)`
// ---------------------------------------------------------------------------

function fromDefaultParam(node: SyntaxNode, filePath: string): ExtractedFallback | null {
  const pattern = node.childForFieldName('pattern');
  const value = node.childForFieldName('value');
  if (!pattern || !value) return null;
  // Only plain-identifier params — destructuring patterns (`{ a } = …`) are a
  // different shape, not a single-field fallback.
  if (pattern.type !== 'identifier') return null;
  const field = pattern.text;
  const lit = scalarLiteral(value);
  if (!lit) return null;

  // A defaulted parameter fires when the argument is absent (undefined).
  return build(field, 'absent', lit, node, filePath);
}

// ---------------------------------------------------------------------------
// 3. Guarded assignment — `if (x == null) x = DEFAULT;`
// ---------------------------------------------------------------------------

function fromGuardedAssign(ifNode: SyntaxNode, filePath: string): ExtractedFallback | null {
  const cond = ifNode.childForFieldName('condition');
  const conseq = ifNode.childForFieldName('consequence');
  if (!cond || !conseq) return null;

  const guard = matchNullGuard(unwrapParens(cond));
  if (!guard) return null;

  const assign = findAssignmentTo(conseq, guard.target);
  if (!assign) return null;
  const lit = scalarLiteral(assign);
  if (!lit) return null;

  return build(guard.target, guard.trigger, lit, ifNode, filePath);
}

/**
 * Recognize a `<target> == null` / `=== null` / `== undefined` /
 * `=== undefined` guard. Returns the target identifier (root field) and the
 * trigger the operator implies.
 */
function matchNullGuard(
  node: SyntaxNode,
): { target: string; targetNode: SyntaxNode; trigger: FallbackContract['trigger'] } | null {
  if (node.type !== 'binary_expression') return null;
  const op = node.childForFieldName('operator');
  const left = node.childForFieldName('left');
  const right = node.childForFieldName('right');
  if (!op || !left || !right) return null;
  if (op.text !== '==' && op.text !== '===') return null;

  const isNull = (n: SyntaxNode): boolean => n.type === 'null';
  const isUndef = (n: SyntaxNode): boolean =>
    n.type === 'undefined' || (n.type === 'identifier' && n.text === 'undefined');

  // The target sits on whichever side isn't the null/undefined literal.
  const pairs: Array<[SyntaxNode, SyntaxNode]> = [
    [left, right],
    [right, left],
  ];
  for (const [tgt, lit] of pairs) {
    const field = targetField(tgt);
    if (!field) continue;
    // `=== null` with strict equality is a pure null check; everything else
    // (`== null`, `== undefined`, `=== undefined`) covers the nullish case.
    if (isNull(lit)) {
      const trigger: FallbackContract['trigger'] = op.text === '===' ? 'null' : 'null-or-absent';
      return { target: field, targetNode: tgt, trigger };
    }
    if (isUndef(lit)) {
      const trigger: FallbackContract['trigger'] = op.text === '===' ? 'absent' : 'null-or-absent';
      return { target: field, targetNode: tgt, trigger };
    }
  }
  return null;
}

/**
 * Find `<target> = <value>` inside the consequence and return the value node.
 * Matches the same root field the guard tested so a guard-then-default pair
 * is structurally linked, not two unrelated statements.
 */
function findAssignmentTo(conseq: SyntaxNode, target: string): SyntaxNode | null {
  let value: SyntaxNode | null = null;
  walk(conseq, (n) => {
    if (value) return false;
    if (n.type === 'assignment_expression') {
      const lhs = n.childForFieldName('left');
      const rhs = n.childForFieldName('right');
      if (lhs && rhs && targetField(lhs) === target) {
        value = rhs;
        return false;
      }
    }
    return true;
  });
  return value;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function build(
  field: string,
  trigger: FallbackContract['trigger'],
  defaultValue: LiteralValue,
  node: SyntaxNode,
  filePath: string,
): ExtractedFallback {
  return {
    identity: `${field}.fallback`,
    contract: { target: { field }, trigger, defaultValue },
    source: {
      filePath,
      lineStart: node.startPosition.row + 1,
      lineEnd: node.endPosition.row + 1,
    },
  };
}

/** Root field name of a target: `x` → `x`; `obj.field` → `field`. */
function targetField(node: SyntaxNode): string | null {
  if (node.type === 'identifier') return node.text;
  if (node.type === 'member_expression' || node.type === 'subscript_expression') {
    const prop = node.childForFieldName('property');
    if (prop && prop.type === 'property_identifier') return prop.text;
  }
  return null;
}

/**
 * A scalar default value — string, number, boolean, null, or a bare
 * identifier (a named constant / enum member used as the default). Anything
 * else (call, object/array literal, nested coalescing) is not a value
 * fallback and returns null so the site is skipped.
 */
function scalarLiteral(node: SyntaxNode): LiteralValue | null {
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
    case 'identifier': {
      // `undefined` as a default is a no-op, not a real fallback.
      if (node.text === 'undefined') return null;
      return { kind: 'identifier', ref: node.text };
    }
    default:
      return null;
  }
}

function unwrapParens(node: SyntaxNode): SyntaxNode {
  let n = node;
  while (n.type === 'parenthesized_expression') {
    const inner = n.namedChild(0);
    if (!inner) break;
    n = inner;
  }
  return n;
}

function stringText(node: SyntaxNode): string {
  const frag = node.namedChild(0);
  if (frag && frag.type === 'string_fragment') return frag.text;
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
