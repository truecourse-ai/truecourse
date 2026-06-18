/**
 * C# state-machine fact readers (the inline-ternary C# arm for index.ts).
 *
 *   - transition map: a dictionary-initializer `new() { ["from"] = new[]{"to"}, … }`
 *     (`Allowed` in the fixture) — keys are `element_binding_expression`s, values
 *     are string arrays (or `Array.Empty<string>()` for terminal states).
 *   - field assignment: `<receiver>.<Field> = "<literal>"`, with the property
 *     resolved to its mapped DB column so the comparator's `status` scope matches.
 */

import type { Node as SyntaxNode } from 'web-tree-sitter';
import type { ParsedSource } from '../source-walker.js';
import { csStringText, namedChildOfType, walkCs } from '../shared/cs-nodes.js';
import { resolveColumn, type CsColumnMap } from '../shared/cs-column-map.js';
import type { TransitionMapFact } from './index.js';

export function readCsTransitionMap(node: SyntaxNode, s: ParsedSource): TransitionMapFact | null {
  if (node.type !== 'implicit_object_creation_expression' && node.type !== 'object_creation_expression') return null;
  const init = namedChildOfType(node, 'initializer_expression');
  if (!init || init.namedChildCount === 0) return null;
  const pairs: [string, string][] = [];
  const keys: string[] = [];
  for (let i = 0; i < init.namedChildCount; i++) {
    const entry = init.namedChild(i);
    if (entry?.type === 'comment') continue;
    if (entry?.type !== 'assignment_expression') return null;
    const left = entry.childForFieldName('left');
    const right = entry.childForFieldName('right');
    if (!left || !right || left.type !== 'element_binding_expression') return null;
    const key = csElementKey(left, s.source);
    if (key === null) return null;
    const tos = csArrayStrings(right, s.source);
    if (tos === null) return null;
    keys.push(key);
    for (const to of tos) pairs.push([key, to]);
  }
  if (keys.length === 0) return null;
  return { pairs, keys, filePath: s.filePath, lineStart: node.startPosition.row + 1, lineEnd: node.endPosition.row + 1 };
}

export function readCsFieldAssignment(
  node: SyntaxNode,
  s: ParsedSource,
  columnMap: CsColumnMap,
): { receiver: string; field: string; value: string } | null {
  if (node.type !== 'assignment_expression') return null;
  const lhs = node.childForFieldName('left');
  const rhs = node.childForFieldName('right');
  if (!lhs || !rhs || lhs.type !== 'member_access_expression') return null;
  const obj = lhs.childForFieldName('expression');
  const prop = lhs.childForFieldName('name');
  if (obj?.type !== 'identifier' || prop?.type !== 'identifier') return null;
  if (rhs.type !== 'string_literal') return null;
  const value = csStringText(rhs, s.source);
  if (value === null) return null;
  return {
    receiver: s.source.slice(obj.startIndex, obj.endIndex),
    field: resolveColumn(columnMap, s.source.slice(prop.startIndex, prop.endIndex)),
    value,
  };
}

/** `["placed"]` → `placed`. */
function csElementKey(left: SyntaxNode, source: string): string | null {
  let key: string | null = null;
  walkCs(left, (n) => {
    if (key === null && n.type === 'string_literal') key = csStringText(n, source);
  });
  return key;
}

/** `new[]{"a","b"}` → ['a','b']; `Array.Empty<string>()` → []; else null. */
function csArrayStrings(node: SyntaxNode, source: string): string[] | null {
  if (node.type === 'implicit_array_creation_expression' || node.type === 'array_creation_expression') {
    const init = namedChildOfType(node, 'initializer_expression');
    if (!init) return [];
    const out: string[] = [];
    for (let i = 0; i < init.namedChildCount; i++) {
      const el = init.namedChild(i);
      if (el?.type !== 'string_literal') return null;
      const v = csStringText(el, source);
      if (v === null) return null;
      out.push(v);
    }
    return out;
  }
  if (node.type === 'invocation_expression') {
    const fn = node.childForFieldName('function');
    if (fn?.type === 'member_access_expression') {
      const recv = fn.childForFieldName('expression');
      const name = fn.childForFieldName('name');
      const recvText = recv ? source.slice(recv.startIndex, recv.endIndex) : '';
      const nameText = name ? source.slice(name.startIndex, name.endIndex) : '';
      if (recvText === 'Array' && nameText.startsWith('Empty')) return [];
    }
  }
  return null;
}
