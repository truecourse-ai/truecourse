/**
 * C# named-constant extractor. Produces `ExtractedConstant` records in the
 * same shape the TS/Python extractors do.
 *
 * Recognized shape: a `const` or `static readonly` field whose initializer is a
 * literal —
 *
 *   const int MaxRetry = 5;
 *   const string ApiKey = "api_key";
 *   static readonly Dictionary<string,int> DiscountTiers = new() { ["bronze"] = 5 };
 *
 * `<literal>` = string / int / real / bool / null / dictionary-initializer where
 * every value is also a literal. Anything else (calls, arrays, mixed) is
 * skipped. HashSet-typed value-sets are enum-shaped → handled by the enum
 * extractor, not here.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { ExtractedConstant } from './types.js';
import { csStringText, namedChildOfType, walkCs } from '../shared/cs-nodes.js';

const UNPARSEABLE = Symbol('unparseable');
const SET_TYPE = /^(?:HashSet|ISet|SortedSet|FrozenSet|IReadOnlySet)\b/;

export function extractCsConstantsFromFile(filePath: string, source: string, tree: Tree): ExtractedConstant[] {
  const out: ExtractedConstant[] = [];
  walkCs(tree.rootNode, (node) => {
    if (node.type !== 'field_declaration') return;
    if (!isConstField(node, source)) return;
    const decl = namedChildOfType(node, 'variable_declaration');
    if (!decl) return;
    const typeNode = decl.childForFieldName('type');
    const typeText = typeNode ? source.slice(typeNode.startIndex, typeNode.endIndex) : '';
    if (SET_TYPE.test(typeText)) return; // enum-shaped — the enum extractor owns it
    const declarator = namedChildOfType(decl, 'variable_declarator');
    if (!declarator) return;
    const nameNode = declarator.childForFieldName('name');
    if (!nameNode) return;
    const valueNode = initializerOf(declarator, nameNode);
    if (!valueNode) return;
    const value = parseCsLiteral(valueNode, source);
    if (value === UNPARSEABLE) return;
    out.push({
      name: source.slice(nameNode.startIndex, nameNode.endIndex),
      value,
      shape: 'const-literal',
      source: { filePath, lineStart: node.startPosition.row + 1, lineEnd: node.endPosition.row + 1 },
    });
  });
  return out;
}

function isConstField(node: SyntaxNode, source: string): boolean {
  let isConst = false, isStatic = false, isReadonly = false;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c?.type !== 'modifier') continue;
    const t = source.slice(c.startIndex, c.endIndex);
    if (t === 'const') isConst = true;
    else if (t === 'static') isStatic = true;
    else if (t === 'readonly') isReadonly = true;
  }
  return isConst || (isStatic && isReadonly);
}

/** First named child of `variable_declarator` that isn't the `name` node. */
function initializerOf(declarator: SyntaxNode, nameNode: SyntaxNode): SyntaxNode | null {
  for (let i = 0; i < declarator.namedChildCount; i++) {
    const c = declarator.namedChild(i);
    if (c && c.id !== nameNode.id) return c;
  }
  return null;
}

function parseCsLiteral(node: SyntaxNode, source: string): unknown {
  switch (node.type) {
    case 'integer_literal':
      return parseInt(slice(node, source).replace(/_/g, '').replace(/[uUlL]+$/, ''), 10);
    case 'real_literal':
      return parseFloat(slice(node, source).replace(/_/g, '').replace(/[fFdDmM]$/, ''));
    case 'string_literal': {
      const v = csStringText(node, source);
      return v === null ? UNPARSEABLE : v;
    }
    case 'boolean_literal':
      return slice(node, source) === 'true';
    case 'null_literal':
      return null;
    case 'prefix_unary_expression': {
      const n = Number(slice(node, source).replace(/\s/g, ''));
      return Number.isNaN(n) ? UNPARSEABLE : n;
    }
    case 'object_creation_expression':
    case 'implicit_object_creation_expression': {
      const init = namedChildOfType(node, 'initializer_expression');
      if (!init || init.namedChildCount === 0) return UNPARSEABLE;
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < init.namedChildCount; i++) {
        const entry = init.namedChild(i);
        if (entry?.type !== 'assignment_expression') return UNPARSEABLE; // not a dictionary-initializer
        const left = entry.childForFieldName('left');
        const right = entry.childForFieldName('right');
        if (!left || !right) return UNPARSEABLE;
        const key = keyFromElementBinding(left, source);
        if (key === null) return UNPARSEABLE;
        const v = parseCsLiteral(right, source);
        if (v === UNPARSEABLE) return UNPARSEABLE;
        obj[key] = v;
      }
      return obj;
    }
    default:
      return UNPARSEABLE;
  }
}

/** `["bronze"]` → `bronze` (element_binding_expression → argument → string). */
function keyFromElementBinding(node: SyntaxNode, source: string): string | null {
  if (node.type !== 'element_binding_expression') return null;
  let key: string | null = null;
  walkCs(node, (n) => {
    if (key === null && n.type === 'string_literal') key = csStringText(n, source);
  });
  return key;
}

function slice(n: SyntaxNode, source: string): string {
  return source.slice(n.startIndex, n.endIndex);
}
