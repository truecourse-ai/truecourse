/**
 * Raw-SQL string-literal extractor for JS/TS.
 *
 * Finds SQL strings passed to `.raw(...)`, `.query(...)`, the `sql`
 * tagged-template, or assigned to top-level constants like
 * `const ROWS_SQL = '...'`. Extracts WHERE-clause predicates with a
 * tolerant Postgres-dialect regex parser.
 *
 * Coverage:
 *   - WHERE col = value         → eq
 *   - WHERE col != value        → neq    (also `<>`)
 *   - WHERE col IS [NOT] NULL   → is-null / is-not-null
 *   - WHERE col {>,>=,<,<=} v   → range ops
 *   - WHERE col IN (...)        → in
 *   - WHERE col NOT IN (...)    → not-in
 *   - WHERE col BETWEEN x AND y → between
 *   - WHERE col [I]LIKE 'pat'   → like / ilike
 *   - CTEs (one WHERE per `WITH x AS (...)`) → multiple ExtractedQuery
 *
 * Heuristic for the date-range binding mirrors the Knex/Prisma
 * adapters: column with both a lower and upper bound predicate.
 *
 * Out of scope for v1 (yields `unparseable[]` entries, never silently
 * dropped per PLAN_GAP_1_QUERY_RULE.md Q2):
 *   - Sub-queries inside WHERE (`WHERE col IN (SELECT ...)`)
 *   - OR clauses
 *   - Window functions in predicates
 *   - User-defined function calls in predicates (kept as raw)
 *   - Template-literal substitutions (`${marketClause}`) — extractor
 *     records a `raw` unparseable entry for the substitution position.
 *
 * Postgres-flavored ::cast syntax is stripped before predicate matching
 * (e.g. `?::date` → `?`).
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { LiteralValue, Predicate, QualifiedColumn } from '../../types/index.js';
import type { ExtractedQuery } from './types.js';

const SQL_HOST_METHODS = new Set(['raw', 'query', 'unsafe']);
const SQL_TAG_NAMES = new Set(['sql', 'SQL']);

export function extractRawSqlQueriesFromFile(
  filePath: string,
  source: string,
  tree: Tree,
): ExtractedQuery[] {
  const results: ExtractedQuery[] = [];

  walk(tree.rootNode, (node) => {
    // Pattern 1: `<x>.raw('SQL')`, `<x>.query('SQL')` — the SQL is the
    // first arg of a recognized SQL host method call.
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      if (fn?.type === 'member_expression') {
        const method = fn.childForFieldName('property')?.text ?? '';
        if (SQL_HOST_METHODS.has(method)) {
          const args = collectArgs(node);
          if (args.length > 0) {
            const extracted = extractFromSqlSource(args[0], filePath, source);
            results.push(...extracted);
          }
        }
      }
    }

    // Pattern 2: `sql\`SELECT ...\`` tagged template
    if (node.type === 'call_expression' || node.type === 'tagged_template_expression') {
      const fn = node.childForFieldName('function') ?? node.childForFieldName('tag');
      if (fn?.type === 'identifier' && SQL_TAG_NAMES.has(fn.text)) {
        const tplArg = node.childForFieldName('arguments') ?? node.childForFieldName('quasi');
        if (tplArg) {
          const extracted = extractFromSqlSource(tplArg, filePath, source);
          results.push(...extracted);
        }
      }
    }

    // Pattern 3: top-level `const X_SQL = '...'` / `const X_SQL = \`...\``
    // Also `const X_SQL = (...) => \`...\`` arrow returning a template.
    if (node.type === 'variable_declarator') {
      const name = node.childForFieldName('name')?.text ?? '';
      if (looksLikeSqlConstantName(name)) {
        const value = node.childForFieldName('value');
        if (!value) return true;
        const sqlNode = unwrapSqlBearer(value);
        if (sqlNode) {
          const extracted = extractFromSqlSource(sqlNode, filePath, source);
          results.push(...extracted);
        }
      }
    }
    return true;
  });

  return results;
}

// ---------------------------------------------------------------------------
// SQL source unwrappers
// ---------------------------------------------------------------------------

function looksLikeSqlConstantName(name: string): boolean {
  return /(_|^)SQL$/i.test(name) || /SQL$/i.test(name) || /^(ROWS|COUNT|SELECT|INSERT|UPDATE|DELETE)_/i.test(name);
}

/** Drill through arrow-functions / function-expressions to a string-like node. */
function unwrapSqlBearer(node: SyntaxNode): SyntaxNode | null {
  if (node.type === 'string' || node.type === 'template_string') return node;
  if (node.type === 'arrow_function' || node.type === 'function_expression') {
    const body = node.childForFieldName('body');
    if (!body) return null;
    if (body.type === 'string' || body.type === 'template_string') return body;
    // `return <template>` inside a block
    if (body.type === 'statement_block') {
      for (let i = 0; i < body.namedChildCount; i++) {
        const stmt = body.namedChild(i);
        if (stmt?.type === 'return_statement' && stmt.namedChildCount > 0) {
          const r = stmt.namedChild(0);
          if (r?.type === 'string' || r?.type === 'template_string') return r;
        }
      }
    }
  }
  return null;
}

function collectArgs(callNode: SyntaxNode): SyntaxNode[] {
  const argList = callNode.childForFieldName('arguments');
  if (!argList) return [];
  const out: SyntaxNode[] = [];
  for (let i = 0; i < argList.namedChildCount; i++) {
    const c = argList.namedChild(i);
    if (c) out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// SQL text extraction
// ---------------------------------------------------------------------------

interface SqlExtraction {
  text: string;
  /** Whether the SQL has interpolations (`${...}` substitutions). */
  hasInterpolation: boolean;
}

function getSqlText(node: SyntaxNode, source: string): SqlExtraction {
  if (node.type === 'string') {
    // Strip outer quotes
    const raw = source.slice(node.startIndex, node.endIndex);
    return { text: raw.slice(1, -1), hasInterpolation: false };
  }
  if (node.type === 'template_string') {
    // Strip outer backticks; replace ${...} substitutions with a
    // sentinel marker so the predicate parser can skip over them.
    let result = '';
    let hasInterp = false;
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (!c) continue;
      if (c.type === 'template_substitution') {
        result += ' /*TC_INTERP*/ ';
        hasInterp = true;
      } else {
        result += source.slice(c.startIndex, c.endIndex);
      }
    }
    // Tree-sitter excludes the backticks from named children, but the
    // raw approach above may have caught them. Either way, collapse
    // any backticks just in case.
    if (result.length === 0) {
      const raw = source.slice(node.startIndex, node.endIndex);
      result = raw.replace(/^`|`$/g, '');
    }
    return { text: result, hasInterpolation: hasInterp };
  }
  return { text: source.slice(node.startIndex, node.endIndex), hasInterpolation: false };
}

// ---------------------------------------------------------------------------
// SQL parsing
// ---------------------------------------------------------------------------

function extractFromSqlSource(
  sqlNode: SyntaxNode,
  filePath: string,
  source: string,
): ExtractedQuery[] {
  const { text, hasInterpolation } = getSqlText(sqlNode, source);
  return buildQueriesFromSqlText(text, hasInterpolation, {
    filePath,
    lineStart: sqlNode.startPosition.row + 1,
    lineEnd: sqlNode.endPosition.row + 1,
  });
}

/**
 * Language-agnostic core: turn a SQL string (already extracted from
 * whatever host AST — a JS template literal, a Python f-string, a raw
 * const) into `ExtractedQuery` records. Shared by the JS raw-SQL matcher
 * and the Python raw-SQL matcher so the SQL dialect parsing lives in one
 * place. `hasInterpolation` surfaces a coverage-gap unparseable entry.
 */
export function buildQueriesFromSqlText(
  text: string,
  hasInterpolation: boolean,
  loc: { filePath: string; lineStart: number; lineEnd: number },
): ExtractedQuery[] {
  if (!text || !/\bSELECT\b/i.test(text)) return [];

  const blocks = splitSelectBlocks(text);
  const out: ExtractedQuery[] = [];
  for (const block of blocks) {
    const from = findFromClause(block);
    if (!from) continue;
    const wherePieces = findWherePredicates(block);
    const predicates: Predicate[] = [];
    const unparseable: { reason: string; raw: string }[] = [];

    for (const piece of wherePieces) {
      const p = parseSqlPredicate(piece);
      if (p) predicates.push(p);
      else unparseable.push({ reason: 'unrecognised SQL predicate', raw: piece });
    }
    if (hasInterpolation) {
      unparseable.push({ reason: 'string-interpolation substitution skipped', raw: '${...}' });
    }

    out.push({
      entity: from,
      predicates,
      unparseable,
      source: { filePath: loc.filePath, lineStart: loc.lineStart, lineEnd: loc.lineEnd },
      adapter: 'raw-sql',
      dateRangeBinding: detectDateRangeBinding(predicates),
    });
  }
  return out;
}

/**
 * Split a SQL string into separate SELECT blocks. CTEs (`WITH name AS
 * (SELECT ...)`) each become their own block; the top-level SELECT
 * after the CTE list is another block.
 *
 * Pragmatic implementation: split on top-level SELECT keyword
 * occurrences, tracking paren depth so we don't split inside
 * sub-queries. Each chunk gets its own FROM + WHERE parsing.
 */
function splitSelectBlocks(sql: string): string[] {
  const blocks: string[] = [];
  let depth = 0;
  let chunkStart = 0;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && matchesKeywordAt(sql, i, 'SELECT')) {
      if (i > chunkStart) {
        blocks.push(sql.slice(chunkStart, i));
        chunkStart = i;
      }
    }
    i++;
  }
  if (chunkStart < sql.length) blocks.push(sql.slice(chunkStart));

  // Also pull CTE inner SELECTs out: every `<name> AS (...)` block.
  // Paren-balanced (regex would fail on the last CTE since there's no
  // trailing `,` or `)`).
  const cteBlocks: string[] = [];
  const asOpen = /\b\w+\s+AS\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = asOpen.exec(sql)) !== null) {
    const openIdx = m.index + m[0].length - 1; // position of the `(`
    let d = 1;
    let j = openIdx + 1;
    while (j < sql.length && d > 0) {
      if (sql[j] === '(') d++;
      else if (sql[j] === ')') d--;
      j++;
    }
    if (d !== 0) continue; // unbalanced — skip
    const inner = sql.slice(openIdx + 1, j - 1);
    if (/\bSELECT\b/i.test(inner)) cteBlocks.push(inner);
  }
  return [...blocks, ...cteBlocks];
}

function matchesKeywordAt(s: string, i: number, kw: string): boolean {
  if (i > 0 && /\w/.test(s[i - 1])) return false;
  const upper = s.slice(i, i + kw.length).toUpperCase();
  if (upper !== kw) return false;
  const after = s[i + kw.length];
  return !after || !/\w/.test(after);
}

/**
 * Find the FROM clause's primary table. Returns `{table, alias?}`.
 * Handles: `FROM table`, `FROM schema.table`, `FROM table alias`,
 * `FROM table AS alias`.
 */
function findFromClause(sql: string): { table: string; alias?: string } | null {
  const m = sql.match(/\bFROM\s+([\w.]+)(?:\s+(?:AS\s+)?(\w+))?/i);
  if (!m) return null;
  const table = m[1];
  const alias = m[2];
  if (alias && /^(WHERE|GROUP|ORDER|HAVING|LIMIT|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|UNION|ON)$/i.test(alias)) {
    return { table };
  }
  return alias ? { table, alias } : { table };
}

/**
 * Find the WHERE clause's top-level AND-separated predicate pieces.
 * Stops at the next clause keyword. Skips parenthesized sub-expressions
 * so inner sub-queries don't fragment a predicate.
 */
function findWherePredicates(sql: string): string[] {
  const wIdx = sql.search(/\bWHERE\b/i);
  if (wIdx < 0) return [];
  const start = wIdx + 'WHERE'.length;

  // Find the end: next top-level clause keyword (GROUP, ORDER, HAVING,
  // LIMIT, OFFSET, UNION, RETURNING) or end of string. Track paren depth.
  const TERMINATORS = /\b(GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET|UNION|RETURNING)\b/i;
  let depth = 0;
  let end = sql.length;
  for (let i = start; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0) {
      const slice = sql.slice(i);
      if (TERMINATORS.test(slice.slice(0, 32))) {
        const m = slice.match(TERMINATORS);
        if (m && m.index === 0) {
          end = i;
          break;
        }
      }
    }
    if (depth < 0) {
      end = i;
      break;
    }
  }

  const body = sql.slice(start, end).trim();
  return splitTopLevelAnds(body);
}

/**
 * Split a WHERE body by top-level `AND`. OR is preserved INSIDE a
 * single piece (so it surfaces as unparseable later).
 */
function splitTopLevelAnds(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let lastSplit = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && matchesKeywordAt(body, i, 'AND')) {
      const piece = body.slice(lastSplit, i).trim();
      if (piece) out.push(piece);
      lastSplit = i + 'AND'.length;
    }
  }
  const tail = body.slice(lastSplit).trim();
  if (tail) out.push(tail);
  return out;
}

// ---------------------------------------------------------------------------
// Per-predicate regex matching
// ---------------------------------------------------------------------------

const COL = String.raw`([\w.]+)`;
// Match a literal: string, number, true/false, NULL, parameter, identifier,
// or a parenthesised function call. Strip ::cast suffixes.
const VAL = String.raw`((?:\([^)]*\)|'[^']*'|-?\d+(?:\.\d+)?|TRUE|FALSE|NULL|\$\d+|\?|[\w.()]+))(?:\s*::\s*\w+(?:\(\d+(?:,\s*\d+)?\))?)?`;

function parseSqlPredicate(raw: string): Predicate | null {
  const piece = stripCasts(raw.trim());

  // Contains OR → opaque (we don't model OR in v1)
  if (/\bOR\b/i.test(piece)) return { kind: 'raw', sql: raw };

  let m: RegExpMatchArray | null;

  // IS NULL / IS NOT NULL
  m = piece.match(new RegExp(`^${COL}\\s+IS\\s+NOT\\s+NULL$`, 'i'));
  if (m) return { kind: 'is-not-null', column: parseColumnExpr(m[1]) };
  m = piece.match(new RegExp(`^${COL}\\s+IS\\s+NULL$`, 'i'));
  if (m) return { kind: 'is-null', column: parseColumnExpr(m[1]) };

  // BETWEEN x AND y — must precede the generic AND splitter, but since
  // we already split by top-level AND we'd lose this. Handled below
  // as a fallback if `<col> BETWEEN <low>` survived intact.
  m = piece.match(new RegExp(`^${COL}\\s+BETWEEN\\s+${VAL}\\s+AND\\s+${VAL}$`, 'i'));
  if (m) {
    const low = parseSqlLiteral(m[2]);
    const high = parseSqlLiteral(m[3]);
    if (low && high) return { kind: 'between', column: parseColumnExpr(m[1]), low, high };
  }

  // NOT IN (...)
  m = piece.match(new RegExp(`^${COL}\\s+NOT\\s+IN\\s*\\(([^)]*)\\)$`, 'i'));
  if (m) {
    return {
      kind: 'not-in',
      column: parseColumnExpr(m[1]),
      values: parseSqlListLiteral(m[2]),
    };
  }
  // IN (...)
  m = piece.match(new RegExp(`^${COL}\\s+IN\\s*\\(([^)]*)\\)$`, 'i'));
  if (m) {
    return {
      kind: 'in',
      column: parseColumnExpr(m[1]),
      values: parseSqlListLiteral(m[2]),
    };
  }

  // ILIKE 'pattern'
  m = piece.match(new RegExp(`^${COL}\\s+ILIKE\\s+'([^']*)'$`, 'i'));
  if (m) return { kind: 'ilike', column: parseColumnExpr(m[1]), pattern: m[2] };
  // LIKE 'pattern'
  m = piece.match(new RegExp(`^${COL}\\s+LIKE\\s+'([^']*)'$`, 'i'));
  if (m) return { kind: 'like', column: parseColumnExpr(m[1]), pattern: m[2] };

  // Range / equality ops
  m = piece.match(new RegExp(`^${COL}\\s*(>=|<=|<>|!=|=|>|<)\\s*${VAL}$`, 'i'));
  if (m) {
    const col = parseColumnExpr(m[1]);
    const op = m[2];
    const rawVal = m[3];
    const val = parseSqlLiteral(rawVal);
    if (!val) return { kind: 'raw', sql: raw };

    // Distinguish column-vs-literal from column-vs-column. A `name.name`
    // identifier on the right side IS a column reference if it doesn't
    // look like a function call (no parens) and it's not a bind param.
    // parseSqlLiteral returns kind:'identifier' for those — promote to
    // a column-compare predicate.
    if (val.kind === 'identifier' && looksLikeColumnRef(val.ref)) {
      return {
        kind: 'column-compare',
        left: col,
        op: opToCompareKind(op),
        right: parseColumnExpr(val.ref),
      };
    }

    switch (op) {
      case '=':                       return { kind: 'eq', column: col, value: val };
      case '!=': case '<>':          return { kind: 'neq', column: col, value: val };
      case '>':                       return { kind: 'gt', column: col, value: val };
      case '>=':                      return { kind: 'gte', column: col, value: val };
      case '<':                       return { kind: 'lt', column: col, value: val };
      case '<=':                      return { kind: 'lte', column: col, value: val };
    }
  }

  return { kind: 'raw', sql: raw };
}

function looksLikeColumnRef(s: string): boolean {
  // A column reference is a dotted (or bare) identifier with NO parens
  // (`a`, `j.completedon`, `core.jobs.id`), and not a bare function
  // call shape. SQL keywords (NOW, CURRENT_DATE) are uppercased; treat
  // those as identifiers, not column refs.
  if (/[()]/.test(s)) return false;
  if (!/^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)*$/.test(s)) return false;
  const SQL_KEYWORDS = new Set([
    'NOW', 'CURRENT_DATE', 'CURRENT_TIMESTAMP', 'CURRENT_TIME',
    'NULL', 'TRUE', 'FALSE', 'LOCALTIME', 'LOCALTIMESTAMP',
  ]);
  if (SQL_KEYWORDS.has(s.toUpperCase())) return false;
  return true;
}

function opToCompareKind(op: string): 'eq'|'neq'|'gt'|'gte'|'lt'|'lte' {
  switch (op) {
    case '=': return 'eq';
    case '!=': case '<>': return 'neq';
    case '>': return 'gt';
    case '>=': return 'gte';
    case '<': return 'lt';
    case '<=': return 'lte';
    default: return 'eq';
  }
}

function stripCasts(s: string): string {
  // Drop `::date`, `::text`, `::numeric(15,2)` style postgres casts.
  return s.replace(/::\s*\w+(?:\(\d+(?:,\s*\d+)?\))?/g, '');
}

function parseColumnExpr(raw: string): QualifiedColumn {
  const trimmed = raw.trim();
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot < 0) return { column: trimmed };
  return { table: trimmed.slice(0, lastDot), column: trimmed.slice(lastDot + 1) };
}

function parseSqlLiteral(raw: string): LiteralValue | null {
  const s = stripCasts(raw.trim());
  if (!s) return null;
  if (s === 'NULL' || s === 'null') return { kind: 'null' };
  if (/^TRUE$/i.test(s)) return { kind: 'boolean', value: true };
  if (/^FALSE$/i.test(s)) return { kind: 'boolean', value: false };
  if (/^-?\d+$/.test(s)) return { kind: 'number', value: parseInt(s, 10) };
  if (/^-?\d+\.\d+$/.test(s)) return { kind: 'number', value: parseFloat(s) };
  // 'string'
  const sm = s.match(/^'(.*)'$/s);
  if (sm) return { kind: 'string', value: sm[1] };
  // $1 / $2 / ? — bind parameters
  if (s === '?') return { kind: 'parameter' };
  const pm = s.match(/^\$(\d+)$/);
  if (pm) return { kind: 'parameter', index: parseInt(pm[1], 10) };
  // identifier / function call (NOW(), CURRENT_DATE, …)
  return { kind: 'identifier', ref: s };
}

function parseSqlListLiteral(body: string): LiteralValue[] {
  return body
    .split(',')
    .map((s) => parseSqlLiteral(s))
    .filter((v): v is LiteralValue => v !== null);
}

// ---------------------------------------------------------------------------
// Date-range heuristic (shared shape)
// ---------------------------------------------------------------------------

function detectDateRangeBinding(predicates: Predicate[]): { column: QualifiedColumn } | undefined {
  const lowers = new Map<string, QualifiedColumn>();
  const uppers = new Map<string, QualifiedColumn>();
  for (const p of predicates) {
    if (p.kind === 'gte' || p.kind === 'gt') lowers.set(keyOf(p.column), p.column);
    if (p.kind === 'lte' || p.kind === 'lt') uppers.set(keyOf(p.column), p.column);
  }
  for (const [k, col] of lowers) {
    if (uppers.has(k)) return { column: col };
  }
  return undefined;
}

function keyOf(c: QualifiedColumn): string {
  return `${c.table ?? c.alias ?? ''}.${c.column}`;
}

// ---------------------------------------------------------------------------
// AST walk
// ---------------------------------------------------------------------------

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => boolean | void): void {
  const recurse = visit(node);
  if (recurse === false) return;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) walk(c, visit);
  }
}

// ---------------------------------------------------------------------------
// Python raw-SQL host detection
// ---------------------------------------------------------------------------
//
// SQL strings passed to `<conn>.execute(...)` / `text("...")`. Reuses the
// language-agnostic `buildQueriesFromSqlText` core; only the host AST
// shape (Python `call` + f-strings) differs from the JS adapter above.

const PY_SQL_EXEC_METHODS = new Set(['execute', 'exec_driver_sql']);

export function extractPythonRawSqlQueriesFromFile(
  filePath: string,
  source: string,
  tree: Tree,
): ExtractedQuery[] {
  const out: ExtractedQuery[] = [];
  walk(tree.rootNode, (node) => {
    if (node.type === 'call') out.push(...rawSqlFromPyCall(node, filePath, source));
  });
  return out;
}

function rawSqlFromPyCall(node: SyntaxNode, filePath: string, source: string): ExtractedQuery[] {
  const fn = node.childForFieldName('function');
  let isSqlHost = false;
  if (fn?.type === 'attribute' && PY_SQL_EXEC_METHODS.has(fn.childForFieldName('attribute')?.text ?? '')) isSqlHost = true;
  if (fn?.type === 'identifier' && (fn.text === 'text' || fn.text === 'execute')) isSqlHost = true;
  if (!isSqlHost) return [];

  const args = node.childForFieldName('arguments');
  if (!args) return [];
  const out: ExtractedQuery[] = [];
  for (let i = 0; i < args.namedChildCount; i++) {
    const arg = args.namedChild(i);
    if (!arg) continue;
    const sql = pySqlText(arg, source);
    if (!sql) continue;
    out.push(...buildQueriesFromSqlText(sql.text, sql.hasInterpolation, {
      filePath,
      lineStart: arg.startPosition.row + 1,
      lineEnd: arg.endPosition.row + 1,
    }));
  }
  return out;
}

/** A Python string / f-string / adjacent-concatenated string node →
 *  its text + whether it contains `{...}` interpolation. `text(...)`
 *  wrappers are unwrapped. Returns null unless the result is a SELECT. */
function pySqlText(node: SyntaxNode, source: string): { text: string; hasInterpolation: boolean } | null {
  if (node.type === 'call') {
    const fn = node.childForFieldName('function');
    if (fn?.type === 'identifier' && fn.text === 'text') {
      const inner = node.childForFieldName('arguments')?.namedChild(0);
      return inner ? pySqlText(inner, source) : null;
    }
    return null;
  }
  const read = readPyStringNode(node, source);
  if (!read) return null;
  return /\bSELECT\b/i.test(read.text) ? read : null;
}

function readPyStringNode(node: SyntaxNode, source: string): { text: string; hasInterpolation: boolean } | null {
  if (node.type === 'concatenated_string') {
    let text = '';
    let hasInterpolation = false;
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (!c) continue;
      const part = readPyStringNode(c, source);
      if (part) {
        text += part.text;
        hasInterpolation = hasInterpolation || part.hasInterpolation;
      }
    }
    return { text, hasInterpolation };
  }
  if (node.type !== 'string') return null;
  let text = '';
  let hasInterpolation = false;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (!c) continue;
    if (c.type === 'string_content') text += source.slice(c.startIndex, c.endIndex);
    else if (c.type === 'interpolation') {
      text += ' /*INTERP*/ ';
      hasInterpolation = true;
    }
  }
  return { text, hasInterpolation };
}
