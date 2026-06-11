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

const ENUM_CONVENTION_NAME = /^(?:VALID|ALLOWED|KNOWN|ENUM)_/i;
const ENUM_CONVENTION_SUFFIX = /_(?:VALUES|SET|CLASSIFICATIONS|STATUSES|KINDS|TYPES|OPTIONS|CHOICES)$/i;

export function extractPyEnumsFromFile(
  filePath: string,
  source: string,
  tree: Tree,
): ExtractedEnum[] {
  const out: ExtractedEnum[] = [];
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

/** Pull the literal text of a Python `string` node (handles prefixes
 *  like f"" / r"" and triple quotes by reading the string_content). */
function stringValue(node: SyntaxNode, source: string): string | null {
  let content = '';
  let sawContent = false;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c?.type === 'string_content') {
      content += source.slice(c.startIndex, c.endIndex);
      sawContent = true;
    } else if (c?.type === 'interpolation' || c?.type === 'format_specifier') {
      return null; // f-string with interpolation isn't a literal value
    }
  }
  if (sawContent) return content;
  // Empty string ("") has no string_content child.
  const raw = source.slice(node.startIndex, node.endIndex);
  const m = raw.match(/^[a-zA-Z]*('''|"""|'|")([\s\S]*)\1$/);
  return m ? m[2] : null;
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
