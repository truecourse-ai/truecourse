/**
 * Python module-level string-constant resolver. Shared by the enum + constant
 * extractors so an f-string built from other module-level constants resolves to
 * a real literal value.
 *
 * Why it matters: dagster's documented tag keys live in code as
 *   SYSTEM_TAG_PREFIX = "dagster"
 *   SCHEDULE_NAME_TAG = f"{SYSTEM_TAG_PREFIX}/schedule_name"
 *   ...
 * Without resolution, every `*_TAG` constant looks unparseable (f-string with
 * interpolation) and never matches a spec enum like `dagster.automatic-run-tags`.
 * The resolver keeps the existing per-call API of `stringValue(node, source)`
 * while letting callers thread in a name→value-node table to substitute
 * identifier-shaped interpolations.
 *
 * Scope is deliberately narrow:
 *   - Resolves only `{identifier}` interpolations (no attribute access, no
 *     arithmetic, no method calls).
 *   - Operates on module-level assignments collected up-front by
 *     `collectStringConstantTable` — class-scoped or nested-function constants
 *     are not in the table, so a stray same-named local doesn't shadow.
 *   - Bounded depth (4) guards against cyclic references.
 */

import type { Node as SyntaxNode } from 'web-tree-sitter';

const MAX_DEPTH = 4;

/**
 * Collect a module-level table of `name → string-RHS AST node` for assignments
 * of the form
 *   NAME = "..."        (plain literal)
 *   NAME = f"...{X}..." (f-string — resolved lazily by `stringValue`)
 *
 * Only top-level assignments are included. A second assignment to the same
 * name keeps the first (matches Python's "first definition wins" for the kind
 * of module-level config constants this targets).
 */
export function collectStringConstantTable(
  rootNode: SyntaxNode,
  source: string,
): Map<string, SyntaxNode> {
  const table = new Map<string, SyntaxNode>();
  // Module body is the rootNode itself; iterate its immediate children only.
  for (let i = 0; i < rootNode.namedChildCount; i++) {
    const stmt = rootNode.namedChild(i);
    // Top-level assignments are wrapped in `expression_statement`.
    if (stmt?.type !== 'expression_statement') continue;
    const assign = stmt.namedChild(0);
    if (assign?.type !== 'assignment') continue;
    const left = assign.childForFieldName('left');
    if (left?.type !== 'identifier') continue;
    const right = assign.childForFieldName('right');
    if (right?.type !== 'string') continue;
    const name = source.slice(left.startIndex, left.endIndex);
    if (table.has(name)) continue;
    table.set(name, right);
  }
  return table;
}

/**
 * Read a Python string-node's literal value. Handles plain strings, triple
 * quotes, and f-strings whose `{identifier}` interpolations resolve through
 * `table`. Returns null when any part can't be reduced to a static string.
 */
export function stringValue(
  node: SyntaxNode,
  source: string,
  table?: Map<string, SyntaxNode>,
): string | null {
  return resolve(node, source, table, 0);
}

function resolve(
  node: SyntaxNode,
  source: string,
  table: Map<string, SyntaxNode> | undefined,
  depth: number,
): string | null {
  if (node.type !== 'string') return null;
  if (depth > MAX_DEPTH) return null;

  let content = '';
  let sawContent = false;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (!c) continue;
    if (c.type === 'string_content') {
      content += source.slice(c.startIndex, c.endIndex);
      sawContent = true;
      continue;
    }
    if (c.type === 'interpolation') {
      // Format specifiers (`{x:>3}` / `{x!r}`) signal non-string formatting;
      // can't reduce to a literal value.
      if (c.namedChildren.some((g) => g?.type === 'format_specifier')) return null;
      const expr = c.namedChild(0);
      if (expr?.type !== 'identifier' || !table) return null;
      const referent = table.get(source.slice(expr.startIndex, expr.endIndex));
      if (!referent) return null;
      const resolved = resolve(referent, source, table, depth + 1);
      if (resolved === null) return null;
      content += resolved;
      sawContent = true;
      continue;
    }
    if (c.type === 'format_specifier') return null;
  }
  if (sawContent) return content;
  // Empty string ("") has no string_content child.
  const raw = source.slice(node.startIndex, node.endIndex);
  const m = raw.match(/^[a-zA-Z]*('''|"""|'|")([\s\S]*)\1$/);
  return m ? m[2] : null;
}
