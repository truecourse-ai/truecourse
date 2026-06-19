/**
 * General (file, line) → enclosing-function index.
 *
 * Occurrence-level drift identity needs a STABLE per-site anchor so two
 * violations of the same obligation at two different code sites stay
 * distinct drifts. Line numbers churn on unrelated edits, so we anchor on
 * the nearest enclosing function-like SYMBOL instead (`ordersRepo.list`,
 * `JobsRepo.recentlyTouched`, `OrderRepo.list` for Python).
 *
 * Computing that symbol is purely (file, line) → function — kind-agnostic
 * and language-agnostic. So rather than have each extractor capture the
 * symbol at the AST node it happens to hold, we build ONE index over the
 * codebase (a single shared parse pass via `makeDirExtractor`) and resolve
 * every drift's site in a general post-pass (`assignEnclosingSymbols`).
 *
 * The index enumerates every named function-like node's line span; a
 * point-lookup (`enclosingSymbolAt`) returns the innermost span containing
 * a given line, or undefined for top-level code (drift stays
 * obligation-level — the safe default).
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { ArtifactKind, ContractDrift } from '../types/index.js';
import {
  makeDirExtractor,
  type ParsedSource,
  type SupportedLanguage,
} from './source-walker.js';

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

/** A named function-like node's line span. Lines are 1-indexed inclusive. */
export interface FunctionRange {
  symbol: string;
  startLine: number;
  endLine: number;
}

/**
 * Drift kinds that can legitimately recur at multiple code sites for the
 * same (artifact, obligation), so anchoring them to a code symbol gives a
 * stable, distinct identity per site.
 *
 * Artifact-UNIQUE kinds (Operation, Entity, Enum, StateMachine,
 * EffectGroup, AuthRequirement, AuthorizationRule, …) are EXCLUDED: their
 * artifact identity already pins the site, and anchoring them to a code
 * symbol would only churn the identity when a handler moves between
 * functions.
 */
export const SITE_BEARING: ReadonlySet<ArtifactKind> = new Set<ArtifactKind>([
  'QueryRule',
  'ForbiddenArtifact',
  'NamedConstant',
]);

// ---------------------------------------------------------------------------
// JS / TS enumeration
// ---------------------------------------------------------------------------

const FUNCTION_LIKE = new Set([
  'method_definition',
  'function_declaration',
  'generator_function_declaration',
  'function_expression',
  'generator_function',
  // tree-sitter-javascript types a bare `function () {}` expression as
  // `function` (no `_expression` suffix); recognize it for parity.
  'function',
  'arrow_function',
]);

const CLASS_LIKE = new Set(['class_declaration', 'class_expression']);

/**
 * Enumerate every NAMED function-like node in a JS/TS tree as a
 * {symbol, startLine, endLine} range. Anonymous functions (no resolvable
 * name) are skipped — a drift inside one resolves to the nearest NAMED
 * ancestor, or stays obligation-level if there is none.
 */
function enumerateJsFunctions(tree: Tree): FunctionRange[] {
  const out: FunctionRange[] = [];
  const walk = (node: SyntaxNode): void => {
    if (FUNCTION_LIKE.has(node.type)) {
      const symbol = jsQualifiedSymbol(node);
      if (symbol !== undefined) {
        out.push({
          symbol,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c) walk(c);
    }
  };
  walk(tree.rootNode);
  return out;
}

/** Qualified symbol for a JS function-like node: own name + container. */
function jsQualifiedSymbol(fn: SyntaxNode): string | undefined {
  const name = functionOwnName(fn);
  if (name === undefined) return undefined;
  const container = containerName(fn);
  return container ? `${container}.${name}` : name;
}

/**
 * The function's OWN name.
 *   method_definition / *function*_declaration → its `name` field.
 *   arrow_function / function_expression → derived from the binding
 *     construct in `.parent` (variable_declarator | pair |
 *     field_definition | assignment_expression).
 * Returns undefined when no name is resolvable.
 */
function functionOwnName(fn: SyntaxNode): string | undefined {
  if (fn.type === 'method_definition'
    || fn.type === 'function_declaration'
    || fn.type === 'generator_function_declaration') {
    return fn.childForFieldName('name')?.text;
  }

  // arrow_function / function_expression / generator_function — look at how
  // the function value is bound.
  const parent = fn.parent;
  if (!parent) return undefined;

  switch (parent.type) {
    case 'variable_declarator':
      // const foo = () => …  /  const foo = function () {}
      return parent.childForFieldName('name')?.text;
    case 'pair':
      // { foo: () => … }
      return propertyKeyText(parent.childForFieldName('key'));
    case 'public_field_definition':
    case 'field_definition':
      // class C { foo = () => … }
      return propertyKeyText(parent.childForFieldName('name'));
    case 'assignment_expression':
      // obj.foo = () => …  /  foo = () => …
      return parent.childForFieldName('left')?.text;
    default:
      return undefined;
  }
}

/**
 * The CONTAINER name for a function-like node:
 *   - nearest enclosing class_declaration / class_expression → its `name`.
 *   - object-literal method: `method_definition` whose parent is `object`,
 *     whose parent is a `variable_declarator` → that declarator's name
 *     (e.g. `const ordersRepo = { list() {} }` → `ordersRepo`).
 *   - object-literal pair value (`{ list: () => … }` inside
 *     `const ordersRepo = …`) → likewise the declarator name.
 * Returns undefined when there's no container (free function / arrow).
 */
function containerName(fn: SyntaxNode): string | undefined {
  // Object-literal method: method_definition directly inside an `object`.
  const objContainer = objectLiteralContainerName(fn);
  if (objContainer !== undefined) return objContainer;

  // Class container: walk up to the nearest class_declaration/expression.
  let cur: SyntaxNode | null = fn.parent;
  while (cur) {
    if (CLASS_LIKE.has(cur.type)) {
      return cur.childForFieldName('name')?.text;
    }
    // Don't cross into an OUTER function — that function's container isn't
    // ours. Stop the class walk at the first enclosing function-like.
    if (FUNCTION_LIKE.has(cur.type)) break;
    cur = cur.parent;
  }
  return undefined;
}

/**
 * If `fn` is bound as a member of an object literal that is itself the value
 * of a `variable_declarator`, return that declarator's name. Handles both:
 *   const ordersRepo = { list() {} }          (method_definition → object)
 *   const ordersRepo = { list: () => {} }      (arrow → pair → object)
 */
function objectLiteralContainerName(fn: SyntaxNode): string | undefined {
  let member: SyntaxNode | null = null;

  if (fn.type === 'method_definition' && fn.parent?.type === 'object') {
    member = fn;
  } else if (fn.parent?.type === 'pair' && fn.parent.parent?.type === 'object') {
    member = fn.parent;
  }
  if (!member) return undefined;

  const objNode = member.parent; // the `object`
  const declarator = objNode?.parent;
  if (declarator?.type === 'variable_declarator') {
    return declarator.childForFieldName('name')?.text;
  }
  return undefined;
}

/** Read a property key (`property_identifier` | `identifier` | `string`). */
function propertyKeyText(key: SyntaxNode | null): string | undefined {
  if (!key) return undefined;
  if (key.type === 'string') {
    return key.text.slice(1, -1);
  }
  return key.text;
}

// ---------------------------------------------------------------------------
// Python enumeration
// ---------------------------------------------------------------------------

/**
 * Enumerate every `function_definition` (`def`) in a Python tree as a
 * {symbol, startLine, endLine} range. The symbol is the def's name
 * qualified by every enclosing `class_definition`:
 *   class OrderRepo: def list(self): …    → `OrderRepo.list`
 *   top-level def list(): …               → `list`
 * Nested classes chain (`Outer.Inner.method`). A def with no resolvable
 * name is skipped.
 */
function enumeratePyFunctions(tree: Tree): FunctionRange[] {
  const out: FunctionRange[] = [];
  // classStack holds the names of enclosing class_definition ancestors,
  // outermost first.
  const walk = (node: SyntaxNode, classStack: string[]): void => {
    if (node.type === 'class_definition') {
      const className = node.childForFieldName('name')?.text;
      const nextStack = className ? [...classStack, className] : classStack;
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (c) walk(c, nextStack);
      }
      return;
    }

    if (node.type === 'function_definition') {
      const defName = node.childForFieldName('name')?.text;
      if (defName) {
        const symbol = classStack.length > 0
          ? `${classStack.join('.')}.${defName}`
          : defName;
        out.push({
          symbol,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
      }
      // A nested def's container is the function, not the class — reset the
      // class stack so inner defs aren't mis-qualified by an outer class.
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (c) walk(c, []);
      }
      return;
    }

    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c) walk(c, classStack);
    }
  };
  walk(tree.rootNode, []);
  return out;
}

// ---------------------------------------------------------------------------
// Index construction
// ---------------------------------------------------------------------------

interface FileRanges {
  filePath: string;
  ranges: FunctionRange[];
}

function matchFile(s: ParsedSource, enumerate: (tree: Tree) => FunctionRange[]): FileRanges[] {
  const ranges = enumerate(s.tree);
  if (ranges.length === 0) return [];
  return [{ filePath: s.filePath, ranges }];
}

const jsMatcher = (s: ParsedSource): FileRanges[] => matchFile(s, enumerateJsFunctions);
const pyMatcher = (s: ParsedSource): FileRanges[] => matchFile(s, enumeratePyFunctions);

const matchers: Partial<Record<SupportedLanguage, (s: ParsedSource) => FileRanges[]>> = {
  typescript: jsMatcher,
  tsx: jsMatcher,
  javascript: jsMatcher,
  python: pyMatcher,
};

/**
 * Build a `filePath → FunctionRange[]` index over every recognized source
 * file under `codeDir`. One shared parse pass via `makeDirExtractor`
 * (reuses the established per-extractor walk; no extra re-read).
 */
export async function buildSymbolIndex(
  codeDir: string,
): Promise<Map<string, FunctionRange[]>> {
  const perFile = await makeDirExtractor<FileRanges>(matchers)(codeDir);
  const index = new Map<string, FunctionRange[]>();
  for (const f of perFile) {
    // One matcher emits at most one record per file, but group defensively.
    const existing = index.get(f.filePath);
    if (existing) existing.push(...f.ranges);
    else index.set(f.filePath, f.ranges);
  }
  return index;
}

// ---------------------------------------------------------------------------
// Point lookup
// ---------------------------------------------------------------------------

/**
 * Return the INNERMOST (smallest-span) function symbol whose
 * [startLine, endLine] contains `line`, or undefined if `line` is in no
 * function (top-level code). Ties on span are broken by the later start
 * line (the more deeply nested node), which is the conservative innermost
 * choice when two ranges share a span.
 */
export function enclosingSymbolAt(
  ranges: FunctionRange[] | undefined,
  line: number,
): string | undefined {
  if (!ranges || ranges.length === 0) return undefined;
  let best: FunctionRange | undefined;
  let bestSpan = Infinity;
  for (const r of ranges) {
    if (line < r.startLine || line > r.endLine) continue;
    const span = r.endLine - r.startLine;
    if (span < bestSpan || (span === bestSpan && (!best || r.startLine > best.startLine))) {
      best = r;
      bestSpan = span;
    }
  }
  return best?.symbol;
}

// ---------------------------------------------------------------------------
// General post-pass
// ---------------------------------------------------------------------------

/**
 * Resolve `enclosingSymbol` for every SITE-BEARING drift with a real
 * `lineStart` (>0), using the prebuilt index. Mutates the input array's
 * elements. Drifts whose artifact kind is artifact-unique, or that have no
 * concrete line (synthetic/absence sites), are left untouched — they stay
 * obligation-level.
 *
 * A safe no-op when the index is empty (codeDir unavailable / no parsed
 * sources): every lookup returns undefined and drifts stay
 * obligation-level. Call BEFORE `assignOccurrenceIndices` so the symbol is
 * in place when occurrence indices are grouped.
 */
export function assignEnclosingSymbols(
  drifts: ContractDrift[],
  index: Map<string, FunctionRange[]>,
): void {
  for (const d of drifts) {
    if (!SITE_BEARING.has(d.artifactRef.type)) continue;
    if (!(d.lineStart > 0)) continue;
    // Absence drifts (a required predicate is MISSING) are NOT per-site: the
    // violation is the entity's queries collectively lacking X, and the
    // comparator only cites an arbitrary first query for jump-to-code UX.
    // Anchoring them to that incidental site would be semantically wrong and
    // would churn if the cited query changes. Keep them obligation-level.
    if (d.obligationKey.includes('.missing.')) continue;
    const symbol = enclosingSymbolAt(index.get(d.filePath), d.lineStart);
    if (symbol !== undefined) d.enclosingSymbol = symbol;
  }
}
