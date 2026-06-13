/**
 * JS/TS metadata-blob key scanner.
 *
 * Finds keys read/written on a JSON "blob" identifier — the shapes that say
 * "this value lives inside a `metadata` object, not in its own column":
 *
 *   metadata.requiresReason            (member access)
 *   metadata["requiresReason"]         (subscript access)
 *   row.metadata.requiresReason        (member chain — blob is the parent)
 *   { ...metadata, requiresReason: x } (spread + literal key in same object)
 *
 * The blob identifier set (`metadata`, `meta`) is configurable and
 * intentionally narrow — only conventionally-named JSON blobs count, so a
 * normal `config.timeout` access is never mistaken for metadata storage.
 *
 * The scan is feature- and ORM-agnostic: it reduces a tree to a flat list of
 * `(key, location)` observations and never decides the strategy itself — the
 * dispatcher reconciles these against the schema-column set.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { SourceLocation } from '../../types/index.js';

/** Conventional JSON-blob identifier names. */
const BLOB_NAMES = new Set(['metadata', 'meta']);

export interface MetadataKeyHit {
  key: string;
  source: SourceLocation;
}

export function extractMetadataKeysFromFile(
  filePath: string,
  tree: Tree,
): MetadataKeyHit[] {
  const out: MetadataKeyHit[] = [];
  const push = (key: string, node: SyntaxNode): void => {
    if (!key) return;
    out.push({
      key,
      source: {
        filePath,
        lineStart: node.startPosition.row + 1,
        lineEnd: node.endPosition.row + 1,
      },
    });
  };

  walk(tree.rootNode, (node) => {
    // metadata.KEY  /  row.metadata.KEY  (member_expression)
    if (node.type === 'member_expression') {
      const object = node.childForFieldName('object');
      const property = node.childForFieldName('property');
      if (object && property && property.type === 'property_identifier' && isBlobNode(object)) {
        push(property.text, node);
      }
      return true;
    }
    // metadata["KEY"]  (subscript_expression)
    if (node.type === 'subscript_expression') {
      const object = node.childForFieldName('object');
      const index = node.childForFieldName('index');
      if (object && index && isBlobNode(object) && index.type === 'string') {
        push(stripQuotes(index.text), node);
      }
      return true;
    }
    // { ...metadata, KEY: x }  (object with a metadata spread + literal keys)
    if (node.type === 'object') {
      if (objectSpreadsBlob(node)) {
        for (const { key, node: keyNode } of literalKeysOf(node)) push(key, keyNode);
      }
      return true;
    }
    return true;
  });

  return out;
}

/** True when `node` is a blob identifier, or a member chain ending in one
 *  (`metadata`, `meta`, `row.metadata`). */
function isBlobNode(node: SyntaxNode): boolean {
  if (node.type === 'identifier') return BLOB_NAMES.has(node.text);
  if (node.type === 'member_expression') {
    const prop = node.childForFieldName('property');
    return !!prop && prop.type === 'property_identifier' && BLOB_NAMES.has(prop.text);
  }
  return false;
}

/** True when an object literal contains a `...metadata` spread element. */
function objectSpreadsBlob(objectNode: SyntaxNode): boolean {
  for (let i = 0; i < objectNode.namedChildCount; i++) {
    const c = objectNode.namedChild(i);
    if (!c || c.type !== 'spread_element') continue;
    const arg = c.namedChild(0);
    if (arg && isBlobNode(arg)) return true;
  }
  return false;
}

/** Literal property names (`key: value`, `"key": value`) of an object, each
 *  with the node it came from (for source-range reporting). */
function literalKeysOf(objectNode: SyntaxNode): { key: string; node: SyntaxNode }[] {
  const out: { key: string; node: SyntaxNode }[] = [];
  for (let i = 0; i < objectNode.namedChildCount; i++) {
    const c = objectNode.namedChild(i);
    if (!c || c.type !== 'pair') continue;
    const key = c.childForFieldName('key');
    if (!key) continue;
    if (key.type === 'property_identifier') out.push({ key: key.text, node: key });
    else if (key.type === 'string') out.push({ key: stripQuotes(key.text), node: key });
  }
  return out;
}

function stripQuotes(raw: string): string {
  if (raw.length >= 2 && (raw[0] === '"' || raw[0] === "'" || raw[0] === '`')) {
    return raw.slice(1, -1);
  }
  return raw;
}

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => boolean | void): void {
  const recurse = visit(node);
  if (recurse === false) return;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) walk(c, visit);
  }
}
