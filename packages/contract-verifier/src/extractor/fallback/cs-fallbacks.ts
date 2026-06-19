/**
 * C# fallback extractor — the language-general twin of `ts-fallbacks.ts` /
 * `py-fallbacks.ts`. Recognizes the same "null/absent → default" RUNTIME
 * coalescing shape, in C# syntax. C# has no `undefined`, so every null-coalescing
 * / null-guard form fires on `null` (trigger `null`); a defaulted parameter fires
 * on an absent argument (trigger `absent`). Four structural patterns, none
 * specific to any feature, framework, or ORM:
 *
 *   1. Null-coalescing:        `x ?? DEFAULT`          (also `var v = x ?? DEFAULT`)
 *   2. Coalescing assignment:  `x ??= DEFAULT`
 *   3. Default parameter:      `void F(string currency = "USD")`
 *   4. Guarded assignment:     `if (x == null) x = DEFAULT;`  / `if (x is null) …`
 *
 * From each it derives a FallbackContract:
 *   - target       = the coalesced field/input (`x`, `obj.Field` → field `Field`)
 *   - trigger      = `null` (coalescing/guards) | `absent` (default parameter)
 *   - defaultValue = the substituted literal/identifier (LiteralValue)
 *
 * A site whose default is a complex expression (call, object/collection
 * initializer, another `??`) is skipped — the extractor never invents a scalar
 * default from a non-scalar coalescing.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { FallbackContract, LiteralValue } from '../../types/index.js';
import type { ExtractedFallback } from './types.js';
import { walkCs, sliceNode, csStringText } from '../shared/cs-nodes.js';

export function extractCsFallbacksFromFile(
  filePath: string,
  source: string,
  tree: Tree,
): ExtractedFallback[] {
  const out: ExtractedFallback[] = [];
  walkCs(tree.rootNode, (node) => {
    let fb: ExtractedFallback | null = null;
    if (node.type === 'binary_expression') fb = fromCoalesce(node, source, filePath);
    else if (node.type === 'assignment_expression') fb = fromCoalesceAssign(node, source, filePath);
    else if (node.type === 'parameter') fb = fromDefaultParam(node, source, filePath);
    else if (node.type === 'if_statement') fb = fromGuardedAssign(node, source, filePath);
    if (fb) out.push(fb);
  });
  return out;
}

// ---------------------------------------------------------------------------
// 1. Null-coalescing — `x ?? DEFAULT`
// ---------------------------------------------------------------------------

function fromCoalesce(node: SyntaxNode, source: string, filePath: string): ExtractedFallback | null {
  if (opText(node, source) !== '??') return null;
  const left = node.childForFieldName('left');
  const right = node.childForFieldName('right');
  if (!left || !right) return null;
  const field = targetField(left, source);
  if (!field) return null;
  const value = scalarLiteral(right, source);
  if (!value) return null;
  // C# `??` fires only on null.
  return build(field, 'null', value, node, filePath);
}

// ---------------------------------------------------------------------------
// 2. Coalescing assignment — `x ??= DEFAULT`
// ---------------------------------------------------------------------------

function fromCoalesceAssign(node: SyntaxNode, source: string, filePath: string): ExtractedFallback | null {
  if (opText(node, source) !== '??=') return null;
  const left = node.childForFieldName('left');
  const right = node.childForFieldName('right');
  if (!left || !right) return null;
  const field = targetField(left, source);
  if (!field) return null;
  const value = scalarLiteral(right, source);
  if (!value) return null;
  return build(field, 'null', value, node, filePath);
}

// ---------------------------------------------------------------------------
// 3. Default parameter — `void F(string currency = "USD")`
// ---------------------------------------------------------------------------

function fromDefaultParam(node: SyntaxNode, source: string, filePath: string): ExtractedFallback | null {
  const name = node.childForFieldName('name');
  const type = node.childForFieldName('type');
  if (!name || name.type !== 'identifier') return null;
  // The default value is the named child that is neither the `type` nor the
  // `name` field (C# attaches it directly to the parameter, no wrapper node).
  let value: SyntaxNode | null = null;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (!c || c.id === name.id || (type && c.id === type.id)) continue;
    value = c;
  }
  if (!value) return null;
  const lit = scalarLiteral(value, source);
  if (!lit) return null;
  // A defaulted parameter fires when the argument is absent.
  return build(sliceNode(name, source), 'absent', lit, node, filePath);
}

// ---------------------------------------------------------------------------
// 4. Guarded assignment — `if (x == null) x = DEFAULT;` / `if (x is null) …`
// ---------------------------------------------------------------------------

function fromGuardedAssign(ifNode: SyntaxNode, source: string, filePath: string): ExtractedFallback | null {
  const cond = ifNode.childForFieldName('condition');
  const conseq = ifNode.childForFieldName('consequence');
  if (!cond || !conseq) return null;

  const target = matchNullGuard(cond, source);
  if (!target) return null;

  const assign = findAssignmentTo(conseq, target, source);
  if (!assign) return null;
  const lit = scalarLiteral(assign, source);
  if (!lit) return null;

  // C# null guards (`== null`, `is null`) fire only on null.
  return build(target, 'null', lit, ifNode, filePath);
}

/** Recognize `<target> == null` or `<target> is null`; return the target's
 *  root field. C# has no `undefined`, so both are pure null checks. */
function matchNullGuard(node: SyntaxNode, source: string): string | null {
  if (node.type === 'binary_expression') {
    if (opText(node, source) !== '==') return null;
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    if (!left || !right) return null;
    for (const [tgt, lit] of [[left, right], [right, left]] as Array<[SyntaxNode, SyntaxNode]>) {
      if (lit.type !== 'null_literal') continue;
      const field = targetField(tgt, source);
      if (field) return field;
    }
    return null;
  }
  if (node.type === 'is_pattern_expression') {
    const expr = node.childForFieldName('expression');
    const pattern = node.childForFieldName('pattern');
    if (!expr || !pattern) return null;
    // `x is null` — the pattern is a `constant_pattern` wrapping `null_literal`.
    const hasNull = pattern.type === 'constant_pattern' && pattern.namedChild(0)?.type === 'null_literal';
    if (!hasNull) return null;
    return targetField(expr, source);
  }
  return null;
}

/** Find `<target> = <value>` in the consequence and return the value node, so a
 *  guard-then-default pair is structurally linked (same target). */
function findAssignmentTo(conseq: SyntaxNode, target: string, source: string): SyntaxNode | null {
  let value: SyntaxNode | null = null;
  walkCs(conseq, (n) => {
    if (value || n.type !== 'assignment_expression') return;
    if (opText(n, source) !== '=') return;
    const lhs = n.childForFieldName('left');
    const rhs = n.childForFieldName('right');
    if (lhs && rhs && targetField(lhs, source) === target) value = rhs;
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
    source: { filePath, lineStart: node.startPosition.row + 1, lineEnd: node.endPosition.row + 1 },
  };
}

/** Operator text of a binary/assignment expression — the `operator` field when
 *  present, else the slice between the left and right operands. */
function opText(node: SyntaxNode, source: string): string | null {
  const op = node.childForFieldName('operator');
  if (op) return sliceNode(op, source);
  const left = node.childForFieldName('left');
  const right = node.childForFieldName('right');
  if (left && right) return source.slice(left.endIndex, right.startIndex).trim();
  return null;
}

/** Root field of a target: `x` → `x`; `obj.Field` → `Field`. */
function targetField(node: SyntaxNode, source: string): string | null {
  if (node.type === 'identifier') return sliceNode(node, source);
  if (node.type === 'member_access_expression') {
    const name = node.childForFieldName('name');
    if (name) return sliceNode(name, source);
  }
  return null;
}

/**
 * A scalar default value — string, number, bool, null, or a bare identifier
 * (a named constant / enum member). Anything else (call, initializer, nested
 * coalescing) is not a value fallback and returns null so the site is skipped.
 */
function scalarLiteral(node: SyntaxNode, source: string): LiteralValue | null {
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
    case 'identifier':
      return { kind: 'identifier', ref: sliceNode(node, source) };
    default:
      return null;
  }
}
