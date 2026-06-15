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
import { collectStringConstantTable, stringValue } from '../py-string-resolver.js';

const UNPARSEABLE = Symbol('unparseable');

export function extractPyConstantsFromFile(
  filePath: string,
  source: string,
  tree: Tree,
): ExtractedConstant[] {
  const out: ExtractedConstant[] = [];

  // Module-level string-constant table used to resolve f-strings like
  // `SCHEDULE_NAME_TAG = f"{SYSTEM_TAG_PREFIX}/schedule_name"`. Built once per
  // file; passed through `parseLiteral` so any string-typed literal (including
  // dict values + Field defaults) gets the same resolution.
  const stringTable = collectStringConstantTable(tree.rootNode, source);

  // Pass A: Pydantic settings-class fields. A class whose `model_config`
  // declares an env scope (`build_settings_config(("server",))` or
  // `SettingsConfigDict(env_prefix="...")`) exposes each `field = Field(default=v)`
  // under an env-var name `<SCOPE>_<FIELD>`. We emit the scoped name WITHOUT a
  // project prefix (PREFECT_/DAGSTER_/APP_…); the comparator binds it to a spec
  // identity via a value-gated suffix match (shape `settings-field`).
  walk(tree.rootNode, (node) => {
    if (node.type === 'class_definition') {
      out.push(...extractSettingsFields(node, source, filePath, stringTable));
    }
    return true;
  });

  // Pass B: flat module-level / nested literal + Field(validation_alias) constants.
  walk(tree.rootNode, (node) => {
    if (node.type !== 'assignment') return true;
    const left = node.childForFieldName('left');
    if (left?.type !== 'identifier') return true;
    const right = node.childForFieldName('right');
    if (!right) return true;
    const name = source.slice(left.startIndex, left.endIndex);
    const pos = { filePath, lineStart: node.startPosition.row + 1, lineEnd: node.endPosition.row + 1 };

    // Case 1: plain literal RHS (existing behavior for both bare and typed assignments)
    const value = parseLiteral(right, source, stringTable);
    if (value !== UNPARSEABLE) {
      out.push({ name, value, shape: 'const-literal', source: pos });
      return true;
    }

    // Case 2: annotated Pydantic Field(default=<literal>, validation_alias=AliasChoices("env_alias"))
    // In tree-sitter-python v0.21+, `x: Type = Field(...)` is an `assignment` node with a `type`
    // field. The env-alias strings expose the constant under the name the spec uses.
    if (!node.childForFieldName('type')) return true;  // must be a typed assignment
    if (right.type !== 'call') return true;
    const fn = right.childForFieldName('function');
    if (!fn) return true;
    if (!source.slice(fn.startIndex, fn.endIndex).endsWith('Field')) return true;
    const callArgs = right.childForFieldName('arguments');
    if (!callArgs) return true;

    let defaultVal: unknown = UNPARSEABLE;
    const aliasStrings: string[] = [];

    for (let i = 0; i < callArgs.namedChildCount; i++) {
      const arg = callArgs.namedChild(i);
      if (arg?.type !== 'keyword_argument') continue;
      const kwName = arg.childForFieldName('name');
      const kwVal = arg.childForFieldName('value');
      if (!kwName || !kwVal) continue;
      const kw = source.slice(kwName.startIndex, kwName.endIndex);
      if (kw === 'default' && defaultVal === UNPARSEABLE) {
        defaultVal = parseLiteral(kwVal, source, stringTable);
      } else if (kw === 'validation_alias') {
        aliasStrings.push(...extractAliasChoiceStrings(kwVal, source, stringTable));
      }
    }

    if (defaultVal === UNPARSEABLE) return true;
    out.push({ name, value: defaultVal, shape: 'const-literal', source: pos });
    for (const alias of aliasStrings) {
      out.push({ name: alias, value: defaultVal, shape: 'const-literal', source: pos });
    }
    return true;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Pydantic settings-class field extraction (Pass A)
// ---------------------------------------------------------------------------

/**
 * Extract `<SCOPE>_<FIELD>` constants from a Pydantic settings class.
 *
 * Recognizes a class body containing a `model_config = <call>(...)` whose
 * call either:
 *   - passes an explicit `env_prefix="SERVER_"` kwarg, or
 *   - passes a positional tuple of string scope parts, e.g.
 *     `build_settings_config(("worker", "webserver"))`.
 *
 * For each field assignment in the body of the form
 *   `name: Type = Field(default=<literal>, ...)`  or  `name: Type = <literal>`
 * emits a constant named `<SCOPE_JOINED>_<NAME>` (uppercased) with the literal
 * value. The project prefix (PREFECT_/DAGSTER_/…) is intentionally NOT prepended
 * — the comparator's value-gated suffix match supplies it.
 */
function extractSettingsFields(
  classNode: SyntaxNode,
  source: string,
  filePath: string,
  stringTable: Map<string, SyntaxNode>,
): ExtractedConstant[] {
  const body = classNode.childForFieldName('body');
  if (!body) return [];

  const scope = deriveSettingsScope(body, source, stringTable);
  if (scope === null) return [];

  const out: ExtractedConstant[] = [];
  for (let i = 0; i < body.namedChildCount; i++) {
    const stmt = body.namedChild(i);
    if (stmt?.type !== 'expression_statement') continue;
    const assign = stmt.namedChild(0);
    if (assign?.type !== 'assignment') continue;
    // Must be an annotated field: `name: Type = value`.
    if (!assign.childForFieldName('type')) continue;
    const left = assign.childForFieldName('left');
    if (left?.type !== 'identifier') continue;
    const fieldName = source.slice(left.startIndex, left.endIndex);
    if (fieldName === 'model_config') continue;

    const right = assign.childForFieldName('right');
    if (!right) continue;
    const value = fieldDefaultValue(right, source, stringTable);
    if (value === UNPARSEABLE) continue;

    const name = `${scope}_${fieldName}`.toUpperCase();
    out.push({
      name,
      value,
      shape: 'settings-field',
      source: { filePath, lineStart: assign.startPosition.row + 1, lineEnd: assign.endPosition.row + 1 },
    });
  }
  return out;
}

/** The scope string for a settings class, or null if the class is not a
 *  recognizable settings class. `("worker","webserver")` → `"worker_webserver"`;
 *  `env_prefix="SERVER_"` → `"server"`. */
function deriveSettingsScope(
  body: SyntaxNode,
  source: string,
  stringTable: Map<string, SyntaxNode>,
): string | null {
  for (let i = 0; i < body.namedChildCount; i++) {
    const stmt = body.namedChild(i);
    if (stmt?.type !== 'expression_statement') continue;
    const assign = stmt.namedChild(0);
    if (assign?.type !== 'assignment') continue;
    const left = assign.childForFieldName('left');
    if (left?.type !== 'identifier') continue;
    if (source.slice(left.startIndex, left.endIndex) !== 'model_config') continue;
    const right = assign.childForFieldName('right');
    if (right?.type !== 'call') continue;
    const args = right.childForFieldName('arguments');
    if (!args) continue;

    // Form 1: explicit env_prefix="SCOPE_" kwarg.
    for (let j = 0; j < args.namedChildCount; j++) {
      const arg = args.namedChild(j);
      if (arg?.type !== 'keyword_argument') continue;
      const kw = arg.childForFieldName('name');
      const val = arg.childForFieldName('value');
      if (kw && val && source.slice(kw.startIndex, kw.endIndex) === 'env_prefix' && val.type === 'string') {
        const prefix = stringValue(val, source, stringTable);
        if (prefix) return prefix.replace(/_+$/, '').toLowerCase();
      }
    }

    // Form 2: positional tuple of string parts, e.g. ("worker", "webserver").
    for (let j = 0; j < args.namedChildCount; j++) {
      const arg = args.namedChild(j);
      if (arg?.type !== 'tuple') continue;
      const parts: string[] = [];
      for (let k = 0; k < arg.namedChildCount; k++) {
        const el = arg.namedChild(k);
        if (el?.type === 'string') {
          const v = stringValue(el, source, stringTable);
          if (v) parts.push(v);
        }
      }
      if (parts.length > 0) return parts.join('_').toLowerCase();
    }
  }
  return null;
}

/** Value of a settings field's RHS: a bare literal, or the `default=` of a
 *  `Field(...)` / `Field(default_factory=...)` call. Returns UNPARSEABLE when
 *  there's no static literal default. */
function fieldDefaultValue(
  right: SyntaxNode,
  source: string,
  stringTable: Map<string, SyntaxNode>,
): unknown {
  const direct = parseLiteral(right, source, stringTable);
  if (direct !== UNPARSEABLE) return direct;
  if (right.type !== 'call') return UNPARSEABLE;
  const fn = right.childForFieldName('function');
  if (!fn || !source.slice(fn.startIndex, fn.endIndex).endsWith('Field')) return UNPARSEABLE;
  const args = right.childForFieldName('arguments');
  if (!args) return UNPARSEABLE;
  for (let i = 0; i < args.namedChildCount; i++) {
    const arg = args.namedChild(i);
    if (arg?.type !== 'keyword_argument') continue;
    const kw = arg.childForFieldName('name');
    const val = arg.childForFieldName('value');
    if (kw && val && source.slice(kw.startIndex, kw.endIndex) === 'default') {
      return parseLiteral(val, source, stringTable);
    }
  }
  return UNPARSEABLE;
}

function parseLiteral(
  node: SyntaxNode,
  source: string,
  stringTable?: Map<string, SyntaxNode>,
): unknown {
  switch (node.type) {
    case 'string': {
      const v = stringValue(node, source, stringTable);
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
        const v = parseLiteral(c, source, stringTable);
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
        if (keyNode.type === 'string') key = stringValue(keyNode, source, stringTable);
        else if (keyNode.type === 'identifier') key = source.slice(keyNode.startIndex, keyNode.endIndex);
        if (key === null) return UNPARSEABLE;
        const v = parseLiteral(valNode, source, stringTable);
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

// Extracts plain string literals from AliasChoices(AliasPath("x"), "alias1", "alias2").
// AliasPath calls are skipped — only flat string aliases are returned.
function extractAliasChoiceStrings(
  node: SyntaxNode,
  source: string,
  stringTable: Map<string, SyntaxNode>,
): string[] {
  if (node.type !== 'call') return [];
  const fn = node.childForFieldName('function');
  if (!fn) return [];
  const fnText = source.slice(fn.startIndex, fn.endIndex);
  if (!fnText.endsWith('AliasChoices')) return [];
  const args = node.childForFieldName('arguments');
  if (!args) return [];
  const result: string[] = [];
  for (let i = 0; i < args.namedChildCount; i++) {
    const c = args.namedChild(i);
    if (c?.type === 'string') {
      const v = stringValue(c, source, stringTable);
      if (v !== null) result.push(v);
    }
  }
  return result;
}

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => boolean | void): void {
  const recurse = visit(node);
  if (recurse === false) return;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) walk(c, visit);
  }
}
