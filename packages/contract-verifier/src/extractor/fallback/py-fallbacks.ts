/**
 * Python fallback extractor — the language-general twin of `ts-fallbacks.ts`.
 * Recognizes the same "null/absent → default" RUNTIME coalescing shape, in
 * Python syntax. Three structural patterns, none specific to any feature,
 * framework, or ORM:
 *
 *   1. `or` coalescing:       `x = customer.tier or DEFAULT`
 *      Python's idiomatic null/absent default — the `??` analogue.
 *   2. Default parameter:     `def f(currency="USD")`
 *   3. Guarded assignment:    `if x is None: x = DEFAULT`
 *
 * From each it derives a FallbackContract:
 *   - target       = the coalesced field/input (`x`, `obj.field` → field `field`)
 *   - trigger      = absent | null | null-or-absent (from the construct/operator)
 *   - defaultValue = the substituted literal/identifier (QueryRule LiteralValue)
 *
 * A site whose default is a complex expression (call, dict/list literal,
 * another `or`) is skipped — the extractor never invents a scalar default
 * from a non-scalar coalescing, and an empty `= {}` / `= []` parameter
 * default is container plumbing, not a value fallback.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { FallbackContract, LiteralValue } from '../../types/index.js';
import type { ExtractedFallback } from './types.js';

export function extractPyFallbacksFromFile(
  filePath: string,
  source: string,
  tree: Tree,
): ExtractedFallback[] {
  const out: ExtractedFallback[] = [];
  walk(tree.rootNode, (node) => {
    let fb: ExtractedFallback | null = null;
    if (node.type === 'assignment') fb = fromOrAssignment(node, source, filePath);
    else if (node.type === 'default_parameter') fb = fromDefaultParam(node, source, filePath);
    else if (node.type === 'if_statement') fb = fromGuardedAssign(node, source, filePath);
    if (fb) out.push(fb);
    return true;
  });
  return out;
}

// ---------------------------------------------------------------------------
// 1. `or` coalescing — `tier = customer.tier or DEFAULT`
// ---------------------------------------------------------------------------

function fromOrAssignment(node: SyntaxNode, source: string, filePath: string): ExtractedFallback | null {
  const left = node.childForFieldName('left');
  const right = node.childForFieldName('right');
  if (!left || !right || right.type !== 'boolean_operator') return null;
  if (right.childForFieldName('operator')?.type !== 'or') return null;

  // The receiver names the field; the right-most `or` operand is the default.
  const field = targetField(left, source);
  if (!field) return null;
  const def = right.childForFieldName('right');
  if (!def) return null;
  const value = scalarLiteral(def, source);
  if (!value) return null;

  // `or` fires on any falsy value — the nullish/absent case in practice.
  return build(field, 'null-or-absent', value, node, filePath);
}

// ---------------------------------------------------------------------------
// 2. Default parameter — `def f(x="DEFAULT")`
// ---------------------------------------------------------------------------

function fromDefaultParam(node: SyntaxNode, source: string, filePath: string): ExtractedFallback | null {
  const name = node.childForFieldName('name');
  const value = node.childForFieldName('value');
  if (!name || !value || name.type !== 'identifier') return null;
  const field = text(name, source);
  const lit = scalarLiteral(value, source);
  if (!lit) return null;

  // A defaulted parameter fires when the argument is absent.
  return build(field, 'absent', lit, node, filePath);
}

// ---------------------------------------------------------------------------
// 3. Guarded assignment — `if x is None: x = DEFAULT`
// ---------------------------------------------------------------------------

function fromGuardedAssign(ifNode: SyntaxNode, source: string, filePath: string): ExtractedFallback | null {
  const cond = ifNode.childForFieldName('condition');
  const conseq = ifNode.childForFieldName('consequence');
  if (!cond || !conseq) return null;

  const guard = matchNullGuard(cond, source);
  if (!guard) return null;

  const assign = findAssignmentTo(conseq, guard.target, source);
  if (!assign) return null;
  const lit = scalarLiteral(assign, source);
  if (!lit) return null;

  return build(guard.target, guard.trigger, lit, ifNode, filePath);
}

/**
 * Recognize a `<target> is None` / `== None` guard. Returns the target's
 * root field and the trigger the operator implies. `is None` (identity) is a
 * pure null check; `== None` is the nullish case.
 */
function matchNullGuard(
  node: SyntaxNode,
  source: string,
): { target: string; trigger: FallbackContract['trigger'] } | null {
  if (node.type !== 'comparison_operator') return null;
  const cmp = readComparison(node);
  if (!cmp) return null;
  if (cmp.op !== 'is' && cmp.op !== '==') return null;

  const pairs: Array<[SyntaxNode, SyntaxNode]> = [
    [cmp.left, cmp.right],
    [cmp.right, cmp.left],
  ];
  for (const [tgt, lit] of pairs) {
    if (lit.type !== 'none') continue;
    const field = targetField(tgt, source);
    if (!field) continue;
    // `is None` is identity (pure null); `== None` is the nullish case.
    const trigger: FallbackContract['trigger'] = cmp.op === 'is' ? 'null' : 'null-or-absent';
    return { target: field, trigger };
  }
  return null;
}

/**
 * Find `<target> = <value>` inside the consequence and return the value node.
 * Matches the same root field the guard tested so a guard-then-default pair
 * is structurally linked, not two unrelated statements.
 */
function findAssignmentTo(conseq: SyntaxNode, target: string, source: string): SyntaxNode | null {
  let value: SyntaxNode | null = null;
  walk(conseq, (n) => {
    if (value) return false;
    if (n.type === 'assignment') {
      const lhs = n.childForFieldName('left');
      const rhs = n.childForFieldName('right');
      if (lhs && rhs && targetField(lhs, source) === target) {
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
function targetField(node: SyntaxNode, source: string): string | null {
  if (node.type === 'identifier') return text(node, source);
  if (node.type === 'attribute') {
    const prop = node.childForFieldName('attribute');
    if (prop) return text(prop, source);
  }
  if (node.type === 'subscript') {
    const idx = node.childForFieldName('subscript');
    if (idx?.type === 'string') return stringText(idx, source);
  }
  return null;
}

/**
 * A scalar default value — string, number, bool, None, or a bare identifier
 * (a named constant / enum member used as the default). Anything else (call,
 * dict/list literal, nested coalescing) is not a value fallback and returns
 * null so the site is skipped.
 */
function scalarLiteral(node: SyntaxNode, source: string): LiteralValue | null {
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
    case 'identifier':
      return { kind: 'identifier', ref: text(node, source) };
    default:
      return null;
  }
}

interface Comparison {
  left: SyntaxNode;
  op: string;
  right: SyntaxNode;
}

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
