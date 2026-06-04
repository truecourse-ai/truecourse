/**
 * JS/TS named-constant extractor. Recognizes three shapes:
 *
 *   1. const X = <literal>                    → shape: const-literal
 *   2. const cfg = { key: <literal>, ... }    → shape: object-property (one per key)
 *   3. function f(name = <literal>)           → shape: default-arg
 *   3b. (params with defaults inside class methods / arrow fns also)
 *
 * Object property values that are themselves objects nest — we extract
 * the outer constant once with the full nested structure as its value.
 *
 * `<literal>` means: string, number, true/false, null, OR a (possibly
 * nested) object/array literal where every leaf is also a literal.
 * Calls / variable references → unparseable, the constant is skipped.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { ExtractedConstant } from './types.js';

export function extractConstantsFromFile(
  filePath: string,
  source: string,
  tree: Tree,
): ExtractedConstant[] {
  const out: ExtractedConstant[] = [];
  // Track window globals by name so each unique access is emitted once.
  const seenWindowGlobals = new Set<string>();
  walk(tree.rootNode, (node) => {
    // 1. const/let declarator with literal initializer
    if (node.type === 'variable_declarator') {
      const result = extractDeclarator(node, filePath, source);
      out.push(...result);
      return true;
    }
    // 2. default function params (arrow + regular + method)
    if (node.type === 'required_parameter' || node.type === 'optional_parameter' ||
        node.type === 'assignment_pattern') {
      const result = extractDefaultArg(node, filePath, source);
      if (result) out.push(result);
      return true;
    }
    // 3. window.X member-expression accesses (browser window globals)
    if (node.type === 'member_expression') {
      const objNode = node.childForFieldName('object');
      const propNode = node.childForFieldName('property');
      if (objNode?.text === 'window' && propNode?.type === 'property_identifier') {
        const propName = propNode.text;
        if (!seenWindowGlobals.has(propName)) {
          seenWindowGlobals.add(propName);
          out.push({
            name: propName,
            value: undefined,
            shape: 'window-global',
            source: mkLoc(node, filePath),
          });
        }
      }
    }
    return true;
  });
  return out;
}

// ---------------------------------------------------------------------------
// const-literal + object-property
// ---------------------------------------------------------------------------

function extractDeclarator(
  node: SyntaxNode,
  filePath: string,
  source: string,
): ExtractedConstant[] {
  const nameNode = node.childForFieldName('name');
  if (!nameNode || nameNode.type !== 'identifier') return [];
  const name = nameNode.text;
  // Skip if no initializer.
  const valueNode = node.childForFieldName('value');
  if (!valueNode) return [];

  // Walk through `as const` / `satisfies` / `as X` wrappers to the
  // underlying value.
  let inner = valueNode;
  while (inner.type === 'as_expression' || inner.type === 'satisfies_expression') {
    const child = inner.namedChild(0);
    if (!child) break;
    inner = child;
  }

  // Object-property shape: emit one record per key (only when the
  // outer thing is a plain object literal).
  if (inner.type === 'object') {
    const out: ExtractedConstant[] = [];
    // Also emit the outer constant itself with the full object value,
    // so a spec rule named for the outer const can match.
    const outer = parseLiteralValue(inner);
    if (outer !== UNPARSEABLE) {
      out.push({
        name,
        value: outer,
        shape: 'const-literal',
        source: mkLoc(node, filePath),
      });
    }
    for (const [k, v, kNode] of objectEntries(inner, source)) {
      if (v === UNPARSEABLE) continue;
      out.push({
        name: k,
        value: v,
        shape: 'object-property',
        source: mkLoc(kNode, filePath),
      });
      // Also emit the dotted form "OuterName.key" so specs that name
      // a constant as "Obj.prop" can match via normal name normalization.
      out.push({
        name: `${name}.${k}`,
        value: v,
        shape: 'object-property',
        source: mkLoc(kNode, filePath),
      });
    }
    return out;
  }

  // const-literal (string/number/boolean/null/array/etc.)
  const parsed = parseLiteralValue(inner);
  if (parsed === UNPARSEABLE) return [];
  return [{
    name,
    value: parsed,
    shape: 'const-literal',
    source: mkLoc(node, filePath),
  }];
}

// ---------------------------------------------------------------------------
// default-arg
// ---------------------------------------------------------------------------

function extractDefaultArg(
  node: SyntaxNode,
  filePath: string,
  source: string,
): ExtractedConstant | null {
  // Three shapes tree-sitter emits depending on context:
  //   required_parameter / optional_parameter: child is `name = value` assignment_pattern
  //   assignment_pattern (standalone in some grammars):
  //     left = name, right = value
  if (node.type === 'assignment_pattern') {
    const leftNode = node.childForFieldName('left');
    const rightNode = node.childForFieldName('right');
    if (!leftNode || !rightNode) return null;
    if (leftNode.type !== 'identifier') return null;
    const parsed = parseLiteralValue(rightNode);
    if (parsed === UNPARSEABLE) return null;
    return {
      name: leftNode.text,
      value: parsed,
      shape: 'default-arg',
      source: mkLoc(node, filePath),
    };
  }
  // tree-sitter-typescript wraps function params in required_parameter
  // / optional_parameter nodes with `pattern` and `value` fields. The
  // pattern holds the identifier; the value (if present) is the default.
  if (node.type === 'required_parameter' || node.type === 'optional_parameter') {
    const patternNode = node.childForFieldName('pattern');
    const valueNode = node.childForFieldName('value');
    if (!patternNode || !valueNode) return null;
    if (patternNode.type !== 'identifier') return null;
    const parsed = parseLiteralValue(valueNode);
    if (parsed === UNPARSEABLE) return null;
    return {
      name: patternNode.text,
      value: parsed,
      shape: 'default-arg',
      source: mkLoc(node, filePath),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Literal value parsing
// ---------------------------------------------------------------------------

const UNPARSEABLE = Symbol('unparseable');

function parseLiteralValue(node: SyntaxNode): unknown {
  switch (node.type) {
    case 'string': {
      const raw = node.text;
      return raw.slice(1, -1);
    }
    case 'template_string': {
      // Only accept template strings with NO interpolation as literal.
      // Inspect children: if any template_substitution exists, bail.
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (c?.type === 'template_substitution') return UNPARSEABLE;
      }
      const raw = node.text;
      return raw.slice(1, -1);
    }
    case 'number': {
      const n = parseFloat(node.text);
      if (Number.isNaN(n)) return UNPARSEABLE;
      return n;
    }
    case 'unary_expression': {
      // -42 / +5 — only with a numeric operand.
      const opNode = node.children[0];
      const argNode = node.namedChild(0);
      if (!opNode || !argNode) return UNPARSEABLE;
      if (argNode.type !== 'number') return UNPARSEABLE;
      const n = parseFloat(argNode.text);
      if (Number.isNaN(n)) return UNPARSEABLE;
      if (opNode.text === '-') return -n;
      if (opNode.text === '+') return n;
      return UNPARSEABLE;
    }
    case 'true':  return true;
    case 'false': return false;
    case 'null':  return null;
    case 'array': {
      const items: unknown[] = [];
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (!c) continue;
        const v = parseLiteralValue(c);
        if (v === UNPARSEABLE) return UNPARSEABLE;
        items.push(v);
      }
      return items;
    }
    case 'object': {
      const out: Record<string, unknown> = {};
      for (let i = 0; i < node.namedChildCount; i++) {
        const pair = node.namedChild(i);
        if (pair?.type !== 'pair') continue;
        const keyNode = pair.childForFieldName('key');
        const valueNode = pair.childForFieldName('value');
        if (!keyNode || !valueNode) continue;
        let key = '';
        if (keyNode.type === 'property_identifier' || keyNode.type === 'identifier') {
          key = keyNode.text;
        } else if (keyNode.type === 'string') {
          key = keyNode.text.slice(1, -1);
        } else {
          return UNPARSEABLE;
        }
        const v = parseLiteralValue(valueNode);
        if (v === UNPARSEABLE) return UNPARSEABLE;
        out[key] = v;
      }
      return out;
    }
    default:
      // Function calls, identifiers, member expressions, etc. — not literals.
      return UNPARSEABLE;
  }
}

function* objectEntries(
  objNode: SyntaxNode,
  _source: string,
): Generator<[string, unknown, SyntaxNode], void, void> {
  for (let i = 0; i < objNode.namedChildCount; i++) {
    const pair = objNode.namedChild(i);
    if (pair?.type !== 'pair') continue;
    const keyNode = pair.childForFieldName('key');
    const valueNode = pair.childForFieldName('value');
    if (!keyNode || !valueNode) continue;
    let key = '';
    if (keyNode.type === 'property_identifier' || keyNode.type === 'identifier') {
      key = keyNode.text;
    } else if (keyNode.type === 'string') {
      key = keyNode.text.slice(1, -1);
    } else {
      continue;
    }
    const v = parseLiteralValue(valueNode);
    yield [key, v, pair];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkLoc(node: SyntaxNode, filePath: string) {
  return {
    filePath,
    lineStart: node.startPosition.row + 1,
    lineEnd: node.endPosition.row + 1,
  };
}

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => boolean | void): void {
  const recurse = visit(node);
  if (recurse === false) return;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) walk(c, visit);
  }
}
