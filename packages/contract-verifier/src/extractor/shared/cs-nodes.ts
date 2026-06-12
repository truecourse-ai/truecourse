/**
 * Shared C# (tree-sitter-c-sharp) node helpers used by every C# extractor /
 * fact matcher. Centralised so the node-type vocabulary lives in one place
 * (node-types.ts) and string/identifier reads are consistent.
 */

import type { Node as SyntaxNode } from 'web-tree-sitter';

/** Depth-first walk over named descendants (incl. `node` itself). */
export function walkCs(node: SyntaxNode, visit: (n: SyntaxNode) => void): void {
  visit(node);
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) walkCs(c, visit);
  }
}

export function sliceNode(n: SyntaxNode, source: string): string {
  return source.slice(n.startIndex, n.endIndex);
}

/** First named child of a given type, or null. */
export function namedChildOfType(node: SyntaxNode, type: string): SyntaxNode | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c && c.type === type) return c;
  }
  return null;
}

/**
 * Text inside a C# `string_literal` / verbatim / interpolated literal — its
 * `string_literal_content` child, with a de-quoted slice fallback (handles the
 * empty-string case where there is no content child).
 */
export function csStringText(node: SyntaxNode, source: string): string | null {
  if (!node.type.endsWith('string_literal')) return null;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c && (c.type === 'string_literal_content' || c.type === 'verbatim_string_literal_content')) {
      return source.slice(c.startIndex, c.endIndex);
    }
  }
  const raw = source.slice(node.startIndex, node.endIndex);
  const m = raw.match(/^@?\$?"([\s\S]*)"$/);
  return m ? m[1] : '';
}

/** PascalCase/camelCase → snake_case (the `[Column]` fallback + the bridge that
 *  lets a contract column like `tenant_id` match the C# property `TenantId`). */
export function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/^_/, '')
    .toLowerCase();
}

/**
 * Read a C# string node's text + whether it contains `{...}` interpolation,
 * following `+` concatenation and interpolated strings. Mirrors the Python
 * raw-SQL reader (interpolations → ` /*INTERP* /` placeholder so the shared
 * `buildQueriesFromSqlText` surfaces the coverage gap identically). Used by the
 * Dapper matcher. Returns null for non-string nodes.
 */
export function readCsharpString(node: SyntaxNode, source: string): { text: string; hasInterpolation: boolean } | null {
  if (node.type.endsWith('string_literal')) {
    return { text: csStringText(node, source) ?? '', hasInterpolation: false };
  }
  if (node.type === 'interpolated_string_expression') {
    let text = '';
    let hasInterpolation = false;
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (!c) continue;
      if (c.type === 'interpolation') {
        text += ' /*INTERP*/ ';
        hasInterpolation = true;
      } else {
        text += source.slice(c.startIndex, c.endIndex);
      }
    }
    return { text, hasInterpolation };
  }
  if (node.type === 'binary_expression') {
    const op = node.childForFieldName('operator');
    if (op && source.slice(op.startIndex, op.endIndex) === '+') {
      const l = node.childForFieldName('left');
      const r = node.childForFieldName('right');
      const left = l ? readCsharpString(l, source) : null;
      const right = r ? readCsharpString(r, source) : null;
      if (left && right) {
        return { text: left.text + right.text, hasInterpolation: left.hasInterpolation || right.hasInterpolation };
      }
    }
  }
  return null;
}
