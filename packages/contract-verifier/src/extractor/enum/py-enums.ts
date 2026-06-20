/**
 * Python enum-shape extractor. Produces `ExtractedEnum` records in the
 * same shape the TS extractor does, so the (language-agnostic) Enum
 * comparator diffs them without caring about the source language.
 *
 * Recognized shapes:
 *   1. enum class:   class OrderStatus(str, Enum): PLACED = "placed"
 *   2. Literal alias: CustomerTier = Literal["bronze", "silver"]
 *   3. set literal:   NON_TERMINAL_SET = {"paid", "shipped"}   (conventional name)
 *   4. frozenset:     X_SET = frozenset({"a", "b"})            (conventional name)
 *   5. list literal:  VALID_X = ["a", "b"]                     (conventional name)
 *
 * Numeric/`auto()` enum members are skipped (string-valued enums only,
 * matching the TS extractor's v1 scope).
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { ExtractedEnum, EnumShape } from './types.js';
import { collectStringConstantTable, stringValue } from '../py-string-resolver.js';

const ENUM_CONVENTION_NAME = /^(?:VALID|ALLOWED|KNOWN|ENUM)_/i;
const ENUM_CONVENTION_SUFFIX = /_(?:VALUES|SET|CLASSIFICATIONS|STATUSES|KINDS|TYPES|OPTIONS|CHOICES)$/i;

export function extractPyEnumsFromFile(
  filePath: string,
  source: string,
  tree: Tree,
): ExtractedEnum[] {
  const out: ExtractedEnum[] = [];
  const stringTable = collectStringConstantTable(tree.rootNode, source);
  walk(tree.rootNode, (node) => {
    if (node.type === 'class_definition') {
      const decl = extractEnumClass(node, filePath, source);
      if (decl) out.push(decl);
      return true;
    }
    if (node.type === 'assignment') {
      const decl = extractAssignmentEnum(node, filePath, source);
      if (decl) out.push(decl);
      return true;
    }
    return true;
  });
  out.push(...synthesizeInstanceRegistryEnum(tree.rootNode, filePath, source));
  out.push(...synthesizeDiscriminatedUnionEnum(tree.rootNode, filePath, source));
  out.push(...synthesizeConstantClusterEnums(tree.rootNode, filePath, source, stringTable));
  out.push(...synthesizeSelectorUnionEnum(tree.rootNode, filePath, source));
  return out;
}

// ---------------------------------------------------------------------------
// Discriminated union of Pydantic models → enum
//
// A closed categorical set is often modeled as a tagged union of model classes,
// each carrying a string `Literal` discriminator:
//
//   class RunDeployment(Action):
//       type: Literal["run-deployment"] = "run-deployment"
//   ...
//   ActionTypes: TypeAlias = Union[DoNothing, RunDeployment, ...]
//
// The "enum" is the set of discriminator strings. We map each member class to
// its discriminator, then synthesize one ExtractedEnum (named after the union
// alias) with those strings as values — so the comparator binds it (by value
// set) to a spec enum like `AutomationActionType`.
// ---------------------------------------------------------------------------

function synthesizeDiscriminatedUnionEnum(
  root: SyntaxNode,
  filePath: string,
  source: string,
): ExtractedEnum[] {
  // 1. className → discriminator literal, for every class declaring
  //    `type: Literal["x"]` (decorated classes included).
  const discriminatorOf = new Map<string, string>();
  walk(root, (node) => {
    if (node.type !== 'class_definition') return true;
    const className = textOfField(node, 'name', source);
    const body = node.childForFieldName('body');
    if (!className || !body) return true;
    for (let i = 0; i < body.namedChildCount; i++) {
      const stmt = body.namedChild(i);
      if (stmt?.type !== 'expression_statement') continue;
      const assign = stmt.namedChild(0);
      if (assign?.type !== 'assignment') continue;
      const left = assign.childForFieldName('left');
      const typeAnn = assign.childForFieldName('type');
      if (left?.type !== 'identifier' || !typeAnn) continue;
      if (source.slice(left.startIndex, left.endIndex) !== 'type') continue;
      const lit = literalStringOfAnnotation(typeAnn, source);
      if (lit !== null) discriminatorOf.set(className, lit);
    }
    return true;
  });
  if (discriminatorOf.size === 0) return [];

  // 2. Union aliases: `NAME[: TypeAlias] = Union[...]` or `NAME = A | B | C`.
  const out: ExtractedEnum[] = [];
  for (let i = 0; i < root.namedChildCount; i++) {
    const stmt = root.namedChild(i);
    if (stmt?.type !== 'expression_statement') continue;
    const assign = stmt.namedChild(0);
    if (assign?.type !== 'assignment') continue;
    const left = assign.childForFieldName('left');
    if (left?.type !== 'identifier') continue;
    const aliasName = source.slice(left.startIndex, left.endIndex);
    const right = assign.childForFieldName('right');
    if (!right) continue;

    const memberClasses = unionMemberIdentifiers(right, source);
    if (memberClasses.length === 0) continue;
    const values = memberClasses
      .map((m) => discriminatorOf.get(m))
      .filter((v): v is string => v !== undefined);
    if (values.length < 3) continue;
    out.push(mkEnum(aliasName, values, 'py-discriminated-union', root, filePath));
  }
  return out;
}

/** The single string in a `Literal["x"]` annotation, else null. The annotation
 *  arrives as a `type` wrapper around a `generic_type`/`subscript` whose base is
 *  `Literal` and whose parameter is the string (possibly nested under a
 *  type_parameter/type_list node), so we unwrap then collect strings deeply. */
function literalStringOfAnnotation(ann: SyntaxNode, source: string): string | null {
  let node: SyntaxNode | null = ann;
  if (node.type === 'type') node = node.namedChild(0);
  if (!node || (node.type !== 'generic_type' && node.type !== 'subscript')) return null;
  const base = node.namedChild(0);
  if (!base || !source.slice(base.startIndex, base.endIndex).endsWith('Literal')) return null;
  const strings = collectStringsDeep(node, source);
  return strings.length === 1 ? strings[0] : null;
}

/** All string-literal values anywhere under `node` (handles type_parameter /
 *  type_list wrappers inside a generic_type). */
function collectStringsDeep(node: SyntaxNode, source: string): string[] {
  const out: string[] = [];
  const visit = (n: SyntaxNode): void => {
    if (n.type === 'string') {
      const v = stringValue(n, source);
      if (v !== null) out.push(v);
      return;
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i);
      if (c) visit(c);
    }
  };
  visit(node);
  return out;
}

/** Member class identifiers of a union RHS: `Union[A, B, C]` (subscript) or
 *  `A | B | C` (chained binary `|`). */
function unionMemberIdentifiers(node: SyntaxNode, source: string): string[] {
  // Form 1: Union[...] subscript.
  if (node.type === 'subscript') {
    const value = node.childForFieldName('value');
    if (value && source.slice(value.startIndex, value.endIndex).endsWith('Union')) {
      const out: string[] = [];
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (c && c !== value) collectTypeIdentifiers(c, out, source);
      }
      return out;
    }
    return [];
  }
  // Form 2: A | B | C — binary_operator chain with `|`.
  if (node.type === 'binary_operator') {
    const text = source.slice(node.startIndex, node.endIndex);
    if (text.includes('|')) {
      const out: string[] = [];
      collectTypeIdentifiers(node, out, source);
      return out;
    }
  }
  return [];
}

/** Collect bare type-name identifiers under a union type node (skips
 *  subscript brackets, the `Union`/`|` operators themselves). */
function collectTypeIdentifiers(node: SyntaxNode, out: string[], source: string): void {
  if (node.type === 'identifier') {
    out.push(source.slice(node.startIndex, node.endIndex));
    return;
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) collectTypeIdentifiers(c, out, source);
  }
}

// ---------------------------------------------------------------------------
// Module-level instance registry → enum
//
// Some codebases model a closed set of categorical values not as an Enum but as
// module-level constants, each an instance of a subclass of a common base:
//
//   class CachePolicy: ...            # base
//   class Inputs(CachePolicy): ...
//   class TaskSource(CachePolicy): ...
//   INPUTS = Inputs()
//   TASK_SOURCE = TaskSource()
//   DEFAULT = INPUTS + TASK_SOURCE    # composed from other members
//
// The categorical "enum" is the set of CONSTANT NAMES (INPUTS, TASK_SOURCE,
// DEFAULT, …). We synthesize one ExtractedEnum named after the base class with
// those names as values, so the comparator binds it (by value-set) to a spec
// enum like `CachePolicies`.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Module-level constant cluster → enum
//
// Documented value sets are often realized as a cluster of UPPER_SNAKE_CASE
// module-level string constants sharing a common value prefix — frequently
// built via f-strings off a single PREFIX constant:
//
//   SYSTEM_TAG_PREFIX = "dagster"
//   SCHEDULE_NAME_TAG = f"{SYSTEM_TAG_PREFIX}/schedule_name"
//   PARTITION_NAME_TAG = f"{SYSTEM_TAG_PREFIX}/partition"
//   ...
//
// The shared value prefix is the signal — it identifies the constants as a
// single namespace of allowed values, not a coincidental co-location. We pull
// the longest common value prefix (length ≥ MIN_PREFIX), require at least
// MIN_CLUSTER_MEMBERS string constants under that prefix, and emit one enum
// with the resolved string values. The synthesized name keeps the prefix so a
// later value-overlap match (Jaccard ≥ 0.6) binds it to a spec enum like
// `dagster.automatic-run-tags`. Shape `py-constant-cluster` is heuristic, so
// the comparator treats it like other synthesized shapes — name+overlap
// matching is fine, but `extra-value` is suppressed against it.
// ---------------------------------------------------------------------------

const MIN_PREFIX = 6;
const MIN_CLUSTER_MEMBERS = 3;
const MAX_CLUSTER_MEMBERS = 200;

function synthesizeConstantClusterEnums(
  root: SyntaxNode,
  filePath: string,
  source: string,
  stringTable: Map<string, SyntaxNode>,
): ExtractedEnum[] {
  // Collect (name → resolved string value) for every module-level string
  // constant. The table already canonicalises f-strings via the shared
  // resolver, so we can read each entry as a plain literal here.
  const named: Array<{ name: string; value: string }> = [];
  for (const [name, node] of stringTable) {
    const v = stringValue(node, source, stringTable);
    if (v === null) continue;
    named.push({ name, value: v });
  }
  if (named.length < MIN_CLUSTER_MEMBERS) return [];

  // Partition by longest-shared value prefix of length ≥ MIN_PREFIX.
  // Sort by value first so members of the same prefix are contiguous, then
  // collapse the longest-common-prefix run into a cluster. A trivial prefix
  // (the empty string, or a too-short fragment) yields no cluster.
  named.sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));

  const clusters: Array<{ prefix: string; members: typeof named }> = [];
  let i = 0;
  while (i < named.length) {
    let j = i + 1;
    let prefix = named[i].value;
    while (j < named.length) {
      const next = commonPrefix(prefix, named[j].value);
      if (next.length < MIN_PREFIX) break;
      prefix = next;
      j++;
    }
    if (j - i >= MIN_CLUSTER_MEMBERS && j - i <= MAX_CLUSTER_MEMBERS && prefix.length >= MIN_PREFIX) {
      clusters.push({ prefix, members: named.slice(i, j) });
    }
    i = j === i + 1 ? i + 1 : j;
  }

  // Refuse a cluster whose values aren't a real namespace — `"hello world A"`
  // and `"hello world B"` would share an 11-char prefix without being a value
  // family. Require either a delimiter (`/`, `-`, `_`, `.`, `:`) at the
  // boundary, or that every value's tail past the shared prefix is a clean
  // identifier-shaped token. Either way the prefix has to look like a real
  // namespace boundary, not a coincidental substring overlap.
  //
  // Drop "no-tail" members first: when one constant's value IS the shared
  // prefix (e.g. `SYSTEM_TAG_PREFIX = "dagster"` paired with
  // `SCHEDULE_NAME_TAG = f"{SYSTEM_TAG_PREFIX}/schedule_name"`), that constant
  // is the *building block*, not a member of the value set. Re-derive the
  // common prefix from the remaining members so the namespace boundary
  // (`"dagster/"`) lands correctly, then guard.
  const out: ExtractedEnum[] = [];
  for (const cluster of clusters) {
    const realMembers = cluster.members.filter((m) => m.value.length > cluster.prefix.length);
    if (realMembers.length < MIN_CLUSTER_MEMBERS) continue;
    let prefix = realMembers[0].value;
    for (let k = 1; k < realMembers.length; k++) {
      prefix = commonPrefix(prefix, realMembers[k].value);
      if (prefix.length < MIN_PREFIX) break;
    }
    if (prefix.length < MIN_PREFIX) continue;
    const trailingDelim = /[/\-_.:]$/.test(prefix);
    const allCleanTails =
      trailingDelim ||
      realMembers.every((m) => /^[A-Za-z0-9_\-./:]+$/.test(m.value.slice(prefix.length)));
    if (!allCleanTails) continue;
    const trimmedName = prefix.replace(/[^A-Za-z0-9]+$/, '') || prefix;
    const firstNode = stringTable.get(realMembers[0].name);
    const lastNode = stringTable.get(realMembers[realMembers.length - 1].name);
    out.push({
      name: trimmedName,
      values: [...new Set(realMembers.map((m) => m.value))].sort(),
      shape: 'py-constant-cluster',
      source: {
        filePath,
        lineStart: firstNode ? firstNode.startPosition.row + 1 : 1,
        lineEnd: lastNode ? lastNode.endPosition.row + 1 : 1,
      },
    });
  }
  return out;
}

function commonPrefix(a: string, b: string): string {
  const len = Math.min(a.length, b.length);
  let i = 0;
  while (i < len && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return a.slice(0, i);
}

// ---------------------------------------------------------------------------
// Config-schema Selector union → enum
//
// A closed, mutually-exclusive set of options is commonly modeled in a config
// DSL as a `Selector({...})` whose dict KEYS are the allowed alternatives —
// "exactly one of these" — which is precisely an enumeration:
//
//   def _base_source_schema():
//       return {"local_file": ..., "s3_bucket": ..., "http_feed": ...}
//
//   IMPORT_SCHEMA = {
//       "source": Field([Selector(merge_dicts(_base_source_schema(),
//                                             {"database_table": {...}}))]),
//   }
//
// The "enum" is the set of Selector keys (`local_file`, `s3_bucket`,
// `http_feed`, `database_table`). The schema dict is often assembled with a
// `merge_dicts(...)`-style helper over a dict-returning function plus inline
// literals, so we resolve those statically (same-file functions whose body
// returns a dict literal, and merge/union calls) to recover the full key set.
// Named after the nearest enclosing schema key or assignment so the comparator
// binds it (by value-set, like the other synthesized shapes) to a spec enum
// such as `WorkspaceLoadMethod`. `extra-value` is suppressed against this
// heuristic shape (a Selector may carry internal keys a docs enum omits).
// ---------------------------------------------------------------------------

function synthesizeSelectorUnionEnum(
  root: SyntaxNode,
  filePath: string,
  source: string,
): ExtractedEnum[] {
  // Same-file functions whose body is `return {<string-key>: ...}` → their keys.
  // These are the building blocks a schema assembles via merge helpers.
  const fnReturnKeys = collectDictReturningFunctions(root, source);
  const out: ExtractedEnum[] = [];
  walk(root, (node) => {
    if (node.type !== 'call') return true;
    const fn = node.childForFieldName('function');
    if (!fn) return true;
    const fnName = source.slice(fn.startIndex, fn.endIndex);
    if (!/(^|\.)Selector$/.test(fnName)) return true;
    const arg = firstCallArgument(node);
    if (!arg) return true;
    const keys = collectSchemaDictKeys(arg, source, fnReturnKeys, 0);
    if (keys.length < 2) return true;
    const name = enclosingSchemaName(node, source) ?? fnName;
    out.push(mkEnum(name, keys, 'py-selector-union', node, filePath));
    return true;
  });
  return out;
}

/** Map of same-file `def f(): return {<string>: ...}` functions → their dict
 *  keys. Only a direct dict-literal return is resolved (no control flow). */
function collectDictReturningFunctions(
  root: SyntaxNode,
  source: string,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  walk(root, (node) => {
    if (node.type !== 'function_definition') return true;
    const name = textOfField(node, 'name', source);
    const body = node.childForFieldName('body');
    if (!name || !body) return true;
    for (let i = 0; i < body.namedChildCount; i++) {
      const stmt = body.namedChild(i);
      if (stmt?.type !== 'return_statement') continue;
      let val = stmt.namedChild(0);
      if (val?.type === 'expression_list') val = val.namedChild(0);
      if (val?.type === 'dictionary') {
        const keys = dictStringKeys(val, source);
        if (keys.length > 0) out.set(name, keys);
      }
    }
    return true;
  });
  return out;
}

/** The first positional argument of a call (unwrapping a `keyword_argument`
 *  value if the schema is passed by keyword). */
function firstCallArgument(callNode: SyntaxNode): SyntaxNode | null {
  const args = callNode.childForFieldName('arguments');
  const first = args?.namedChild(0);
  if (!first) return null;
  if (first.type === 'keyword_argument') return first.childForFieldName('value');
  return first;
}

/** Recover the closed key set of a Selector schema argument: a dict literal's
 *  keys, a same-file dict-returning function call, or a `merge_dicts(...)`-style
 *  union over several such sources. Bounded recursion guards malformed input. */
function collectSchemaDictKeys(
  node: SyntaxNode,
  source: string,
  fnReturnKeys: Map<string, string[]>,
  depth: number,
): string[] {
  if (depth > 6) return [];
  if (node.type === 'dictionary') return dictStringKeys(node, source);
  if (node.type === 'call') {
    const fn = node.childForFieldName('function');
    if (!fn) return [];
    const fnName = source.slice(fn.startIndex, fn.endIndex);
    // merge_dicts(a, b, …) / merge(a, b) — union the keys of every argument.
    if (/(^|\.)(?:merge_dicts|merge)$/.test(fnName)) {
      const args = node.childForFieldName('arguments');
      const acc: string[] = [];
      for (let i = 0; args && i < args.namedChildCount; i++) {
        const a = args.namedChild(i);
        if (a) acc.push(...collectSchemaDictKeys(a, source, fnReturnKeys, depth + 1));
      }
      return acc;
    }
    // A bare same-file helper call returning a dict literal.
    const bare = fnName.replace(/^.*\./, '');
    return fnReturnKeys.get(fnName) ?? fnReturnKeys.get(bare) ?? [];
  }
  return [];
}

/** The string keys of a dict literal (`{"a": …, "b": …}`). Non-string keys are
 *  skipped — only a stable, name-like key set is an enumeration. */
function dictStringKeys(dictNode: SyntaxNode, source: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < dictNode.namedChildCount; i++) {
    const pair = dictNode.namedChild(i);
    if (pair?.type !== 'pair') continue;
    const key = pair.childForFieldName('key');
    if (key?.type !== 'string') continue;
    const v = stringValue(key, source);
    if (v !== null) out.push(v);
  }
  return [...new Set(out)];
}

/** Name a Selector union after the nearest enclosing schema key (`"source":
 *  Selector(...)`) or assignment (`X = Selector(...)`), walking up the tree. */
function enclosingSchemaName(callNode: SyntaxNode, source: string): string | null {
  let n: SyntaxNode | null = callNode.parent;
  for (let hops = 0; n && hops < 8; hops++) {
    if (n.type === 'pair') {
      const key = n.childForFieldName('key');
      if (key?.type === 'string') {
        const v = stringValue(key, source);
        if (v !== null) return v;
      }
    }
    if (n.type === 'assignment') {
      const left = n.childForFieldName('left');
      if (left?.type === 'identifier') return source.slice(left.startIndex, left.endIndex);
    }
    n = n.parent;
  }
  return null;
}

function synthesizeInstanceRegistryEnum(
  root: SyntaxNode,
  filePath: string,
  source: string,
): ExtractedEnum[] {
  // 1. class → direct base name (first superclass identifier). Classes may be
  //    `@decorator`-wrapped (`@dataclass class X(Base)`), in which case
  //    tree-sitter nests the `class_definition` inside a `decorated_definition`.
  const baseOf = new Map<string, string>();
  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i);
    const node =
      child?.type === 'class_definition'
        ? child
        : child?.type === 'decorated_definition'
          ? child.childForFieldName('definition')
          : null;
    if (node?.type !== 'class_definition') continue;
    const name = textOfField(node, 'name', source);
    const supers = node.childForFieldName('superclasses');
    if (!name || !supers) continue;
    const first = supers.namedChild(0);
    if (first?.type === 'identifier') baseOf.set(name, source.slice(first.startIndex, first.endIndex));
  }
  // Categorical base = a class that is the direct base of ≥2 classes in the file.
  const subclassCount = new Map<string, number>();
  for (const base of baseOf.values()) subclassCount.set(base, (subclassCount.get(base) ?? 0) + 1);
  const categoricalBases = new Set([...subclassCount].filter(([, n]) => n >= 2).map(([b]) => b));
  if (categoricalBases.size === 0) return [];

  // Resolve a class name to its categorical base (walk the in-file chain).
  const resolveBase = (cls: string): string | null => {
    let cur = cls;
    for (let hops = 0; hops < 8; hops++) {
      if (categoricalBases.has(cur)) return cur;
      const next = baseOf.get(cur);
      if (!next) return null;
      cur = next;
    }
    return null;
  };

  // 2. Module-level UPPER_SNAKE assignments. First collect constructor-based
  //    members (NAME = Ctor(...)); then a second pass folds in composed members
  //    (NAME = A + B …) whose operands are already members of one base group.
  const group = new Map<string, string[]>(); // base → member names
  const memberBase = new Map<string, string>(); // member name → its base
  const deferred: Array<{ name: string; rhs: SyntaxNode }> = [];

  for (let i = 0; i < root.namedChildCount; i++) {
    const stmt = root.namedChild(i);
    if (stmt?.type !== 'expression_statement') continue;
    const assign = stmt.namedChild(0);
    if (assign?.type !== 'assignment') continue;
    if (assign.childForFieldName('type')) continue; // typed (annotated) — not a plain const
    const left = assign.childForFieldName('left');
    if (left?.type !== 'identifier') continue;
    const name = source.slice(left.startIndex, left.endIndex);
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
    const right = assign.childForFieldName('right');
    if (!right) continue;

    if (right.type === 'call') {
      const fn = right.childForFieldName('function');
      if (fn?.type !== 'identifier') continue;
      const ctor = source.slice(fn.startIndex, fn.endIndex);
      const base = resolveBase(ctor);
      if (base) {
        if (!group.has(base)) group.set(base, []);
        group.get(base)!.push(name);
        memberBase.set(name, base);
      }
    } else {
      deferred.push({ name, rhs: right });
    }
  }

  // Second pass: composed expressions whose leaf identifiers are all members of
  // the same base group.
  for (const { name, rhs } of deferred) {
    const ids = collectIdentifiers(rhs, source);
    if (ids.length === 0) continue;
    const bases = new Set(ids.map((id) => memberBase.get(id)).filter((b): b is string => !!b));
    if (bases.size === 1) {
      const base = [...bases][0];
      group.get(base)!.push(name);
      memberBase.set(name, base);
    }
  }

  const out: ExtractedEnum[] = [];
  for (const [base, members] of group) {
    if (members.length < 3) continue;
    out.push(mkEnum(base, members, 'py-instance-registry', root, filePath));
  }
  return out;
}

/** Leaf identifier names referenced anywhere under `node`. */
function collectIdentifiers(node: SyntaxNode, source: string): string[] {
  const out: string[] = [];
  const visit = (n: SyntaxNode): void => {
    if (n.type === 'identifier') {
      out.push(source.slice(n.startIndex, n.endIndex));
      return;
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i);
      if (c) visit(c);
    }
  };
  visit(node);
  return out;
}

// ---------------------------------------------------------------------------
// 1. class X(str, Enum): A = "a"
// ---------------------------------------------------------------------------

function extractEnumClass(node: SyntaxNode, filePath: string, source: string): ExtractedEnum | null {
  const name = textOfField(node, 'name', source);
  if (!name) return null;
  const supers = node.childForFieldName('superclasses');
  if (!supers) return null;
  const isAutoEnum = superclassesHaveAutoEnum(supers, source);
  if (!superclassesLookEnum(supers, source) && !isAutoEnum) return null;
  const body = node.childForFieldName('body');
  if (!body) return null;
  const values: string[] = [];
  for (let i = 0; i < body.namedChildCount; i++) {
    const stmt = body.namedChild(i);
    if (stmt?.type !== 'expression_statement') continue;
    const assign = stmt.namedChild(0);
    if (assign?.type !== 'assignment') continue;
    const left = assign.childForFieldName('left');
    const right = assign.childForFieldName('right');
    if (right?.type === 'string') {
      const v = stringValue(right, source);
      if (v !== null) values.push(v);
    } else if (isAutoEnum && right?.type === 'call' && left?.type === 'identifier') {
      // AutoEnum.auto() (or equivalent) — member name is the string value.
      values.push(source.slice(left.startIndex, left.endIndex));
    }
  }
  if (values.length === 0) return null;
  return mkEnum(name, values, 'py-enum', node, filePath);
}

// True when the superclass list contains an AutoEnum base (name ends with AutoEnum),
// which uses member names as values via _generate_next_value_.
function superclassesHaveAutoEnum(supers: SyntaxNode, source: string): boolean {
  for (let i = 0; i < supers.namedChildCount; i++) {
    const c = supers.namedChild(i);
    if (!c) continue;
    const text = source.slice(c.startIndex, c.endIndex);
    if (/(^|\.)AutoEnum$/.test(text)) return true;
  }
  return false;
}

function superclassesLookEnum(supers: SyntaxNode, source: string): boolean {
  for (let i = 0; i < supers.namedChildCount; i++) {
    const c = supers.namedChild(i);
    if (!c) continue;
    const text = source.slice(c.startIndex, c.endIndex);
    if (/(^|\.)(?:Int|Str|Flag|IntFlag)?Enum$/.test(text)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 2/3/4/5. assignment forms
// ---------------------------------------------------------------------------

function extractAssignmentEnum(node: SyntaxNode, filePath: string, source: string): ExtractedEnum | null {
  const left = node.childForFieldName('left');
  if (left?.type !== 'identifier') return null;
  const name = source.slice(left.startIndex, left.endIndex);
  const right = node.childForFieldName('right');
  if (!right) return null;

  // 2. Literal["a", "b"]
  if (right.type === 'subscript') {
    const value = right.childForFieldName('value');
    if (value && source.slice(value.startIndex, value.endIndex).endsWith('Literal')) {
      const values = collectStringChildren(right, source);
      if (values.length >= 2) return mkEnum(name, values, 'py-literal', node, filePath);
    }
    return null;
  }

  // Set/list of enum-member references: { StateType.COMPLETED, StateType.FAILED }
  // → values are the member last-segments (COMPLETED, FAILED). The all-attribute-
  //   element shape is the signal (a named subset of an enum), so NO name
  //   convention is required — checked before nameLooksLikeEnumConst below.
  if (right.type === 'set' || right.type === 'list') {
    const attrs = attributeSetValues(right, source);
    if (attrs) {
      return mkEnum(name, attrs, right.type === 'set' ? 'py-set' : 'py-list', node, filePath);
    }
  }

  // Set difference: NAME = list(set(X) - Y) | set(X) - Y → a transient placeholder
  // resolved in enum/index.ts against the extracted X (base) and Y (minus) enums.
  const diff = parseSetDifference(right, source);
  if (diff) {
    return {
      name,
      values: [],
      shape: 'py-set-difference',
      source: { filePath, lineStart: node.startPosition.row + 1, lineEnd: node.endPosition.row + 1 },
      unresolved: diff,
    };
  }

  if (!nameLooksLikeEnumConst(name)) return null;

  // 3. {"a", "b"}  /  5. ["a", "b"]
  if (right.type === 'set' || right.type === 'list') {
    const values = collectStringChildren(right, source);
    if (values.length === 0) return null;
    return mkEnum(name, values, right.type === 'set' ? 'py-set' : 'py-list', node, filePath);
  }

  // 4. frozenset({...}) / set([...])
  if (right.type === 'call') {
    const fn = right.childForFieldName('function');
    const fnName = fn ? source.slice(fn.startIndex, fn.endIndex) : '';
    if (fnName === 'frozenset' || fnName === 'set') {
      const args = right.childForFieldName('arguments');
      const inner = args?.namedChild(0);
      if (inner && (inner.type === 'set' || inner.type === 'list')) {
        const values = collectStringChildren(inner, source);
        if (values.length > 0) return mkEnum(name, values, 'py-set', node, filePath);
      }
    }
  }
  return null;
}

function nameLooksLikeEnumConst(name: string): boolean {
  return ENUM_CONVENTION_NAME.test(name) || ENUM_CONVENTION_SUFFIX.test(name);
}

/** If EVERY element of a set/list node is an attribute access (`X.MEMBER`),
 *  return the member last-segments; else null. (A named subset of enum members.) */
function attributeSetValues(node: SyntaxNode, source: string): string[] | null {
  const out: string[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (!c) continue;
    if (c.type !== 'attribute') return null;
    const attr = c.childForFieldName('attribute');
    if (!attr) return null;
    out.push(source.slice(attr.startIndex, attr.endIndex));
  }
  return out.length >= 2 ? out : null;
}

/** Parse `set(X) - Y`, `list(set(X) - Y)`, `X - Y` into operand enum names.
 *  `set(StateType) - states.TERMINAL_STATES` → { base: 'StateType', minus: 'TERMINAL_STATES' }. */
function parseSetDifference(node: SyntaxNode, source: string): { base: string; minus: string } | null {
  let n = node;
  // Unwrap an outer list()/set()/frozenset()/tuple() wrapper.
  if (n.type === 'call') {
    const fn = n.childForFieldName('function');
    const fnName = fn ? source.slice(fn.startIndex, fn.endIndex) : '';
    if (/^(list|set|frozenset|tuple)$/.test(fnName)) {
      const inner = n.childForFieldName('arguments')?.namedChild(0);
      if (inner) n = inner;
    }
  }
  if (n.type !== 'binary_operator') return null;
  if (!source.slice(n.startIndex, n.endIndex).includes('-')) return null;
  const left = n.childForFieldName('left');
  const right = n.childForFieldName('right');
  if (!left || !right) return null;
  const base = enumOperandName(left, source);
  const minus = enumOperandName(right, source);
  return base && minus ? { base, minus } : null;
}

/** Resolve a set-difference operand to an enum name: `set(X)`→X, `pkg.X`→X, `X`→X. */
function enumOperandName(node: SyntaxNode, source: string): string | null {
  let n = node;
  if (n.type === 'call') {
    const inner = n.childForFieldName('arguments')?.namedChild(0);
    if (inner) n = inner;
  }
  if (n.type === 'identifier') return source.slice(n.startIndex, n.endIndex);
  if (n.type === 'attribute') {
    const a = n.childForFieldName('attribute');
    if (a) return source.slice(a.startIndex, a.endIndex);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect the string leaves directly under `node` (set/list/subscript
 *  elements). Non-string children — e.g. the `Literal` value of a
 *  subscript — are ignored. */
function collectStringChildren(node: SyntaxNode, source: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c?.type !== 'string') continue;
    const v = stringValue(c, source);
    if (v !== null) out.push(v);
  }
  return out;
}

function textOfField(node: SyntaxNode, field: string, source: string): string {
  const c = node.childForFieldName(field);
  return c ? source.slice(c.startIndex, c.endIndex) : '';
}

function mkEnum(name: string, values: string[], shape: EnumShape, node: SyntaxNode, filePath: string): ExtractedEnum {
  return {
    name,
    values: [...new Set(values)].sort(),
    shape,
    source: { filePath, lineStart: node.startPosition.row + 1, lineEnd: node.endPosition.row + 1 },
  };
}

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => boolean | void): void {
  const recurse = visit(node);
  if (recurse === false) return;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) walk(c, visit);
  }
}
