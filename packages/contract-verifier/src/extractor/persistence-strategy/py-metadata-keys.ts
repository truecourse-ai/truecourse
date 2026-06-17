/**
 * Python metadata-blob key scanner — the language-general twin of
 * `ts-metadata-keys.ts`. Finds keys read/written on a JSON "blob" identifier,
 * the shapes that say "this value lives inside a `metadata` object, not in its
 * own column":
 *
 *   metadata.beta_features              (attribute access)
 *   metadata["beta_features"]           (subscript access)
 *   metadata.get("beta_features")       (dict .get(...) access)
 *   row.metadata.beta_features          (attribute chain — blob is the parent)
 *   {**metadata, "beta_features": x}    (dict splat + literal key in same dict)
 *
 * The blob identifier set (`metadata`, `meta`) is shared with the TS scanner
 * and intentionally narrow — only conventionally-named JSON blobs count, so a
 * normal `config.timeout` access is never mistaken for metadata storage.
 *
 * Like its TS twin, the scan reduces a tree to a flat list of `(key, location)`
 * observations and never decides the strategy itself — the dispatcher
 * reconciles these against the schema-column set.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { MetadataKeyHit } from './ts-metadata-keys.js';

/** Conventional JSON-blob identifier names (shared with the TS scanner). */
const BLOB_NAMES = new Set(['metadata', 'meta']);

export function extractPyMetadataKeysFromFile(filePath: string, source: string, tree: Tree): MetadataKeyHit[] {
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
    // metadata.get("KEY")  (dict .get access — checked before plain attribute)
    if (node.type === 'call') {
      const fn = node.childForFieldName('function');
      if (
        fn?.type === 'attribute' &&
        readAttr(fn, source) === 'get' &&
        isBlobNode(fn.childForFieldName('object'), source)
      ) {
        const arg = node.childForFieldName('arguments')?.namedChild(0);
        if (arg?.type === 'string') push(stringText(arg, source), node);
      }
      return true;
    }
    // metadata.KEY  /  row.metadata.KEY  (attribute)
    if (node.type === 'attribute') {
      const object = node.childForFieldName('object');
      const attr = node.childForFieldName('attribute');
      // Skip a method invocation (`metadata.get(...)`) — the attribute there
      // is the dict method name, not a stored key. The `.get("KEY")` form is
      // handled by the `call` branch, which reads the real key from the args.
      if (object && attr && attr.type === 'identifier' && isBlobNode(object, source) && !isCallFunction(node)) {
        push(text(attr, source), node);
      }
      return true;
    }
    // metadata["KEY"]  (subscript)
    if (node.type === 'subscript') {
      const value = node.childForFieldName('value');
      const idx = node.childForFieldName('subscript');
      if (idx?.type === 'string' && isBlobNode(value, source)) {
        push(stringText(idx, source), node);
      }
      return true;
    }
    // {**metadata, "KEY": x}  (dict with a metadata splat + literal keys)
    if (node.type === 'dictionary') {
      if (dictSplatsBlob(node, source)) {
        for (const { key, node: keyNode } of literalKeysOf(node, source)) push(key, keyNode);
      }
      return true;
    }
    return true;
  });

  return out;
}

/** True when `node` is a blob identifier, or an attribute chain ending in one. */
function isBlobNode(node: SyntaxNode | null, source: string): boolean {
  if (!node) return false;
  if (node.type === 'identifier') return BLOB_NAMES.has(text(node, source));
  if (node.type === 'attribute') {
    const attr = node.childForFieldName('attribute');
    return !!attr && attr.type === 'identifier' && BLOB_NAMES.has(text(attr, source));
  }
  return false;
}

/** The attribute (right-hand) name of an `attribute` node. */
function readAttr(attr: SyntaxNode, source: string): string | null {
  const prop = attr.childForFieldName('attribute');
  return prop ? text(prop, source) : null;
}

/** True when `node` is the `function` callee of an enclosing `call` (a method
 *  invocation like `metadata.get(...)`), as opposed to a data-key access. */
function isCallFunction(node: SyntaxNode): boolean {
  const parent = node.parent;
  return !!parent && parent.type === 'call' && parent.childForFieldName('function')?.id === node.id;
}

/** True when a dict literal contains a `**metadata` splat element. */
function dictSplatsBlob(dictNode: SyntaxNode, source: string): boolean {
  for (let i = 0; i < dictNode.namedChildCount; i++) {
    const c = dictNode.namedChild(i);
    if (!c || c.type !== 'dictionary_splat') continue;
    const arg = c.namedChild(0);
    if (arg && isBlobNode(arg, source)) return true;
  }
  return false;
}

/** Literal string keys (`"key": value`) of a dict, each with its key node. */
function literalKeysOf(dictNode: SyntaxNode, source: string): { key: string; node: SyntaxNode }[] {
  const out: { key: string; node: SyntaxNode }[] = [];
  for (let i = 0; i < dictNode.namedChildCount; i++) {
    const c = dictNode.namedChild(i);
    if (!c || c.type !== 'pair') continue;
    const key = c.childForFieldName('key');
    if (key?.type === 'string') out.push({ key: stringText(key, source), node: key });
  }
  return out;
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
