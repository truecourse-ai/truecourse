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
  return out;
}

// ---------------------------------------------------------------------------
// 1. class X(str, Enum): A = "a"
// ---------------------------------------------------------------------------

function extractEnumClass(node: SyntaxNode, filePath: string, source: string): ExtractedEnum | null {
  const name = textOfField(node, 'name', source);
  if (!name) return null;
  const supers = node.childForFieldName('superclasses');
  if (!supers || !superclassesLookEnum(supers, source)) return null;
  const body = node.childForFieldName('body');
  if (!body) return null;
  const values: string[] = [];
  for (let i = 0; i < body.namedChildCount; i++) {
    const stmt = body.namedChild(i);
    if (stmt?.type !== 'expression_statement') continue;
    const assign = stmt.namedChild(0);
    if (assign?.type !== 'assignment') continue;
    const right = assign.childForFieldName('right');
    if (right?.type === 'string') {
      const v = stringValue(right, source);
      if (v !== null) values.push(v);
    }
  }
  if (values.length === 0) return null;
  return mkEnum(name, values, 'py-enum', node, filePath);
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
