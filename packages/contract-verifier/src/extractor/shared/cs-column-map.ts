/**
 * C# entity property → DB column resolution. EF entities map PascalCase
 * properties to snake_case columns via `[Column("snake_case")]`. Several drift
 * keys embed the snake_case column (`query.predicate.missing.tenant_id.eq`,
 * `field.placed_at.mutability`), so the C# query / entity / state-machine / auth
 * matchers resolve a property access back to its mapped column through this map.
 *
 * Built once per `rootDir` (memoised): a single walk of every C# file collecting
 * `property_declaration` → `[Column]` (snake-case fallback when unannotated).
 */

import type { Node as SyntaxNode } from 'web-tree-sitter';
import { eachParsedSource } from '../source-walker.js';
import { csStringText, snakeCase, walkCs } from './cs-nodes.js';

/** PascalCase property → mapped DB column (snake_case), flat across entities. */
export type CsColumnMap = ReadonlyMap<string, string>;

const cache = new Map<string, Promise<CsColumnMap>>();

export function csColumnMap(rootDir: string): Promise<CsColumnMap> {
  let p = cache.get(rootDir);
  if (!p) {
    p = build(rootDir);
    cache.set(rootDir, p);
  }
  return p;
}

async function build(rootDir: string): Promise<CsColumnMap> {
  const map = new Map<string, string>();
  await eachParsedSource(rootDir, (s) => {
    if (s.lang !== 'csharp') return;
    walkCs(s.tree.rootNode, (n) => {
      if (n.type !== 'property_declaration') return;
      const nameNode = n.childForFieldName('name');
      if (!nameNode || nameNode.type !== 'identifier') return;
      const prop = s.source.slice(nameNode.startIndex, nameNode.endIndex);
      const col = columnFromAttributes(n, s.source) ?? snakeCase(prop);
      if (!map.has(prop)) map.set(prop, col); // first writer wins; identity fallback is safe
    });
  });
  return map;
}

/** Read `[Column("snake_case")]` (or `[ColumnAttribute("…")]`) off a
 *  property_declaration's attribute_list children. */
function columnFromAttributes(prop: SyntaxNode, source: string): string | null {
  for (let i = 0; i < prop.namedChildCount; i++) {
    const list = prop.namedChild(i);
    if (!list || list.type !== 'attribute_list') continue;
    for (let j = 0; j < list.namedChildCount; j++) {
      const attr = list.namedChild(j);
      if (!attr || attr.type !== 'attribute') continue;
      const nameNode = attr.childForFieldName('name');
      if (!nameNode) continue;
      const attrName = source.slice(nameNode.startIndex, nameNode.endIndex).replace(/Attribute$/, '');
      if (attrName !== 'Column') continue;
      let found: string | null = null;
      walkCs(attr, (n) => {
        if (found === null && n.type === 'string_literal') found = csStringText(n, source);
      });
      if (found != null) return found;
    }
  }
  return null;
}

/** Resolve a property to its column: explicit `[Column]`, else snake fallback. */
export function resolveColumn(map: CsColumnMap, property: string): string {
  return map.get(property) ?? snakeCase(property);
}
