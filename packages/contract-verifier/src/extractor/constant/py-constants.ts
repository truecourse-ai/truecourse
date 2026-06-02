/**
 * Python named-constant extractor. Produces `ExtractedConstant` records
 * in the same shape the TS extractor does.
 *
 * Recognized shape: an assignment whose left side is a plain identifier
 * and whose right side is a literal —
 *
 *   MAX_RETRY = 3
 *   API_VERSION = "v2"
 *   DISCOUNT_TIERS = {"bronze": 5, "silver": 10}
 *   ALLOWED = ["a", "b"]
 *
 * `<literal>` = string / int / float / True / False / None / dict / list
 * where every leaf is also a literal. Calls, comprehensions, f-strings
 * with interpolation, set literals (enum-shaped — handled by the enum
 * extractor), and `Literal[...]` subscripts are skipped.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { ExtractedConstant } from './types.js';

const UNPARSEABLE = Symbol('unparseable');

export function extractPyConstantsFromFile(
  filePath: string,
  source: string,
  tree: Tree,
): ExtractedConstant[] {
  const out: ExtractedConstant[] = [];
  walk(tree.rootNode, (node) => {
    if (node.type !== 'assignment') return true;
    const left = node.childForFieldName('left');
    if (left?.type !== 'identifier') return true;
    const right = node.childForFieldName('right');
    if (!right) return true;
    const value = parseLiteral(right, source);
    if (value === UNPARSEABLE) return true;
    out.push({
      name: source.slice(left.startIndex, left.endIndex),
      value,
      shape: 'const-literal',
      source: { filePath, lineStart: node.startPosition.row + 1, lineEnd: node.endPosition.row + 1 },
    });
    return true;
  });
  return out;
}

function parseLiteral(node: SyntaxNode, source: string): unknown {
  switch (node.type) {
    case 'string': {
      const v = stringValue(node, source);
      return v === null ? UNPARSEABLE : v;
    }
    case 'integer':
      return parseInt(source.slice(node.startIndex, node.endIndex).replace(/_/g, ''), 10);
    case 'float':
      return parseFloat(source.slice(node.startIndex, node.endIndex).replace(/_/g, ''));
    case 'true':
      return true;
    case 'false':
      return false;
    case 'none':
      return null;
    case 'unary_operator': {
      const text = source.slice(node.startIndex, node.endIndex).replace(/\s|_/g, '');
      const n = Number(text);
      return Number.isNaN(n) ? UNPARSEABLE : n;
    }
    case 'list': {
      const items: unknown[] = [];
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (!c) continue;
        const v = parseLiteral(c, source);
        if (v === UNPARSEABLE) return UNPARSEABLE;
        items.push(v);
      }
      return items;
    }
    case 'dictionary': {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < node.namedChildCount; i++) {
        const pair = node.namedChild(i);
        if (pair?.type !== 'pair') continue;
        const keyNode = pair.childForFieldName('key');
        const valNode = pair.childForFieldName('value');
        if (!keyNode || !valNode) continue;
        let key: string | null = null;
        if (keyNode.type === 'string') key = stringValue(keyNode, source);
        else if (keyNode.type === 'identifier') key = source.slice(keyNode.startIndex, keyNode.endIndex);
        if (key === null) return UNPARSEABLE;
        const v = parseLiteral(valNode, source);
        if (v === UNPARSEABLE) return UNPARSEABLE;
        obj[key] = v;
      }
      return obj;
    }
    default:
      // Calls, subscripts (Literal[...]), sets, comprehensions, identifiers.
      return UNPARSEABLE;
  }
}

function stringValue(node: SyntaxNode, source: string): string | null {
  let content = '';
  let sawContent = false;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c?.type === 'string_content') {
      content += source.slice(c.startIndex, c.endIndex);
      sawContent = true;
    } else if (c?.type === 'interpolation') {
      return null;
    }
  }
  if (sawContent) return content;
  const raw = source.slice(node.startIndex, node.endIndex);
  const m = raw.match(/^[a-zA-Z]*('''|"""|'|")([\s\S]*)\1$/);
  return m ? m[2] : null;
}

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => boolean | void): void {
  const recurse = visit(node);
  if (recurse === false) return;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) walk(c, visit);
  }
}
