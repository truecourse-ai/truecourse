/**
 * C# metadata-blob key scanner — the language-general twin of
 * `ts-metadata-keys.ts` / `py-metadata-keys.ts`. Finds keys read/written on a
 * conventionally-named JSON/dictionary "blob" — the shapes that say "this value
 * lives inside a `Metadata` bag, not in its own column":
 *
 *   o.Metadata.RequiresReason         (member access — JObject/dynamic style)
 *   o.Metadata["cancellationReason"]  (indexer — Dictionary<string, object> style)
 *   metadata["refundPolicy"] = x      (indexer write)
 *
 * Blob identifier names (`metadata`, `meta`, case-insensitive — C# properties are
 * PascalCase) are intentionally narrow, so a normal `config.Timeout` access is
 * never mistaken for metadata storage. The scan never decides the strategy
 * itself — the dispatcher reconciles these key hits against the schema columns.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { SourceLocation } from '../../types/index.js';
import type { MetadataKeyHit } from './ts-metadata-keys.js';
import { walkCs, sliceNode, csStringText } from '../shared/cs-nodes.js';

const BLOB_NAMES = new Set(['metadata', 'meta']);

export function extractCsMetadataKeysFromFile(
  filePath: string,
  source: string,
  tree: Tree,
): MetadataKeyHit[] {
  const out: MetadataKeyHit[] = [];
  const push = (key: string, node: SyntaxNode): void => {
    if (!key) return;
    out.push({ key, source: location(node, filePath) });
  };

  walkCs(tree.rootNode, (node) => {
    // <blob>.KEY  (e.g. o.Metadata.RequiresReason / metadata.RequiresReason)
    if (node.type === 'member_access_expression') {
      const object = node.childForFieldName('expression');
      const name = node.childForFieldName('name');
      if (object && name && isBlobNode(object, source)) push(sliceNode(name, source), node);
      return;
    }
    // <blob>["KEY"]  (indexer read or write)
    if (node.type === 'element_access_expression') {
      const object = node.childForFieldName('expression');
      if (!object || !isBlobNode(object, source)) return;
      const subscript = node.childForFieldName('subscript');
      const key = subscript ? stringSubscript(subscript, source) : null;
      if (key !== null) push(key, node);
    }
  });

  return out;
}

/** A blob identifier (`metadata`/`meta`), or a member access ending in one
 *  (`o.Metadata`, `row.Meta`). Case-insensitive — C# props are PascalCase. */
function isBlobNode(node: SyntaxNode, source: string): boolean {
  if (node.type === 'identifier') return BLOB_NAMES.has(sliceNode(node, source).toLowerCase());
  if (node.type === 'member_access_expression') {
    const name = node.childForFieldName('name');
    return !!name && BLOB_NAMES.has(sliceNode(name, source).toLowerCase());
  }
  return false;
}

/** The string key of a `["..."]` subscript (`bracketed_argument_list`), or null. */
function stringSubscript(subscript: SyntaxNode, source: string): string | null {
  for (let i = 0; i < subscript.namedChildCount; i++) {
    const arg = subscript.namedChild(i);
    const val = arg?.type === 'argument' ? arg.namedChild(0) : arg;
    if (val && val.type.endsWith('string_literal')) return csStringText(val, source) ?? '';
  }
  return null;
}

function location(node: SyntaxNode, filePath: string): SourceLocation {
  return { filePath, lineStart: node.startPosition.row + 1, lineEnd: node.endPosition.row + 1 };
}
