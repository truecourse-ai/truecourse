/**
 * JS/TS enum-shape extractor. Walks a parsed AST and produces an
 * `ExtractedEnum` for each recognized shape:
 *
 *   1. TS string-literal type union:   type X = 'a' | 'b' | 'c'
 *   2. TS enum declaration:            enum X { A = 'a', B = 'b' }
 *   3. Zod enum:                       z.enum(['a', 'b'])
 *   4. Zod union of literals:          z.union([z.literal('a'), z.literal('b')])
 *   5. `as const` runtime object:      const X = { A: 'a', B: 'b' } as const
 *   6. Set literal (named):            const VALID_X = new Set(['a','b'])
 *   7. Array literal (named):          const VALID_X = ['a', 'b']
 *
 * For Set/Array shapes, the name must look like a convention for an
 * enum-of-values: any of `VALID_*`, `ALLOWED_*`, `*_VALUES`, `*_SET`,
 * `*_CLASSIFICATIONS`. Bare-name arrays are intentionally ignored to
 * avoid false positives (a list of `['x', 'y']` is usually not an enum).
 *
 * Numeric values are skipped — v1 only supports string-literal enums.
 * Numeric enum diff comes later.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { ExtractedEnum, EnumShape } from './types.js';

const ENUM_CONVENTION_NAME = /^(?:VALID|ALLOWED|KNOWN|ENUM)_/i;
const ENUM_CONVENTION_SUFFIX = /_(?:VALUES|SET|CLASSIFICATIONS|STATUSES|KINDS|TYPES|OPTIONS|CHOICES)$/i;

export function extractEnumsFromFile(
  filePath: string,
  source: string,
  tree: Tree,
): ExtractedEnum[] {
  const out: ExtractedEnum[] = [];
  walk(tree.rootNode, (node) => {
    // 1. TS type alias with union of string literals
    if (node.type === 'type_alias_declaration') {
      const decl = extractTsTypeAlias(node, filePath, source);
      if (decl) out.push(decl);
      return true;
    }
    // 2. TS enum declaration
    if (node.type === 'enum_declaration') {
      const decl = extractTsEnum(node, filePath, source);
      if (decl) out.push(decl);
      return true;
    }
    // 3+4. Zod enum / union — found inside any expression
    if (node.type === 'call_expression') {
      const zodEnum = extractZodEnum(node, filePath, source);
      if (zodEnum) {
        out.push(zodEnum);
        return true;
      }
      const zodUnion = extractZodUnion(node, filePath, source);
      if (zodUnion) {
        out.push(zodUnion);
        return true;
      }
    }
    // 5/6/7. const X = ... — variable declarator
    if (node.type === 'variable_declarator') {
      const decl = extractRuntimeDeclarator(node, filePath, source);
      if (decl) out.push(decl);
      return true;
    }
    return true;
  });
  return out;
}

// ---------------------------------------------------------------------------
// 1. type X = 'a' | 'b' | 'c'
// ---------------------------------------------------------------------------

function extractTsTypeAlias(node: SyntaxNode, filePath: string, source: string): ExtractedEnum | null {
  const name = node.childForFieldName('name')?.text ?? '';
  const valueNode = node.childForFieldName('value');
  if (!name || !valueNode) return null;
  const values = collectStringUnionMembers(valueNode);
  if (values.length < 2) return null; // need at least 2 alternatives to be enum-shaped
  return mkEnum(name, values, 'ts-union', node, filePath);
}

/** Recursively flatten a `union_type` into its string-literal leaves. */
function collectStringUnionMembers(node: SyntaxNode): string[] {
  const out: string[] = [];
  const walk2 = (n: SyntaxNode) => {
    if (n.type === 'union_type' || n.type === 'parenthesized_type') {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i);
        if (c) walk2(c);
      }
      return;
    }
    if (n.type === 'literal_type') {
      const inner = n.namedChild(0);
      if (inner) walk2(inner);
      return;
    }
    if (n.type === 'string') {
      const text = n.text;
      out.push(text.slice(1, -1));
      return;
    }
  };
  walk2(node);
  return out;
}

// ---------------------------------------------------------------------------
// 2. enum X { A = 'a', B = 'b' }
// ---------------------------------------------------------------------------

function extractTsEnum(node: SyntaxNode, filePath: string, source: string): ExtractedEnum | null {
  const name = node.childForFieldName('name')?.text ?? '';
  if (!name) return null;
  const body = node.childForFieldName('body');
  if (!body) return null;
  const values: string[] = [];
  for (let i = 0; i < body.namedChildCount; i++) {
    const member = body.namedChild(i);
    if (member?.type !== 'enum_assignment' && member?.type !== 'property_identifier') continue;
    // enum_assignment: `A = 'a'` — pull the value from the right side
    if (member.type === 'enum_assignment') {
      const value = member.childForFieldName('value');
      if (value?.type === 'string') values.push(value.text.slice(1, -1));
      // numeric enum members skipped (v1 string-only)
    } else {
      // bare `property_identifier` — `enum X { A, B, C }` — TS numeric
      // auto-incrementing form. Out of scope for v1.
    }
  }
  if (values.length === 0) return null;
  return mkEnum(name, values, 'ts-enum', node, filePath);
}

// ---------------------------------------------------------------------------
// 3. z.enum(['a','b']) — pull the array literal
// ---------------------------------------------------------------------------

function extractZodEnum(node: SyntaxNode, filePath: string, source: string): ExtractedEnum | null {
  const fn = node.childForFieldName('function');
  if (fn?.type !== 'member_expression') return null;
  const method = fn.childForFieldName('property')?.text ?? '';
  if (method !== 'enum') return null;
  const args = collectArgs(node);
  if (args.length === 0) return null;
  const values = collectStringArrayLiterals(args[0]);
  if (values.length === 0) return null;
  // Name = the var the call is assigned to (if any) or just 'z.enum'
  // anonymous. We surface anonymous enums too — comparator matches by
  // value-set similarity if no name match exists.
  const name = inferNameFromContext(node) ?? `<anon>`;
  return mkEnum(name, values, 'zod-enum', node, filePath);
}

// ---------------------------------------------------------------------------
// 4. z.union([z.literal('a'), z.literal('b')])
// ---------------------------------------------------------------------------

function extractZodUnion(node: SyntaxNode, filePath: string, source: string): ExtractedEnum | null {
  const fn = node.childForFieldName('function');
  if (fn?.type !== 'member_expression') return null;
  const method = fn.childForFieldName('property')?.text ?? '';
  if (method !== 'union') return null;
  const args = collectArgs(node);
  if (args.length === 0) return null;
  if (args[0].type !== 'array') return null;
  const values: string[] = [];
  for (let i = 0; i < args[0].namedChildCount; i++) {
    const item = args[0].namedChild(i);
    if (item?.type !== 'call_expression') return null;
    // z.literal('a')
    const itemFn = item.childForFieldName('function');
    if (itemFn?.type !== 'member_expression') return null;
    const itemMethod = itemFn.childForFieldName('property')?.text ?? '';
    if (itemMethod !== 'literal') return null;
    const litArgs = collectArgs(item);
    if (litArgs.length === 0 || litArgs[0].type !== 'string') return null;
    values.push(litArgs[0].text.slice(1, -1));
  }
  if (values.length < 2) return null;
  const name = inferNameFromContext(node) ?? `<anon>`;
  return mkEnum(name, values, 'zod-union', node, filePath);
}

// ---------------------------------------------------------------------------
// 5/6/7. const X = ... — runtime forms
// ---------------------------------------------------------------------------

function extractRuntimeDeclarator(node: SyntaxNode, filePath: string, source: string): ExtractedEnum | null {
  const name = node.childForFieldName('name')?.text ?? '';
  const value = node.childForFieldName('value');
  if (!name || !value) return null;

  // 5. `as const` object: `{ A: 'a' } as const`
  if (value.type === 'as_expression' || value.type === 'satisfies_expression') {
    const expr = value.namedChild(0);
    if (expr?.type === 'object') {
      const values = collectObjectStringValues(expr);
      if (values.length >= 2) return mkEnum(name, values, 'as-const-object', node, filePath);
    }
  }
  if (value.type === 'object') {
    // Bare object — only count if it follows `as const` pattern via
    // type assertion that the parser already represented as `object`.
    // Skip otherwise — too noisy.
  }

  // 6. new Set([...]) — must have conventional name
  if (value.type === 'new_expression' && namedNodeIs(value, 'constructor', 'identifier', 'Set')) {
    if (!nameLooksLikeEnumConst(name)) return null;
    const args = collectArgs(value);
    if (args.length === 0) return null;
    const values = collectStringArrayLiterals(args[0]);
    if (values.length === 0) return null;
    return mkEnum(name, values, 'set-literal', node, filePath);
  }

  // 7. plain array literal — must have conventional name
  if (value.type === 'array') {
    if (!nameLooksLikeEnumConst(name)) return null;
    const values = collectStringArrayLiterals(value);
    if (values.length === 0) return null;
    return mkEnum(name, values, 'array-literal', node, filePath);
  }
  return null;
}

function nameLooksLikeEnumConst(name: string): boolean {
  return ENUM_CONVENTION_NAME.test(name) || ENUM_CONVENTION_SUFFIX.test(name);
}

function namedNodeIs(
  parent: SyntaxNode,
  fieldName: string,
  childType: string,
  childText: string,
): boolean {
  const c = parent.childForFieldName(fieldName);
  return c?.type === childType && c.text === childText;
}

function collectObjectStringValues(obj: SyntaxNode): string[] {
  const out: string[] = [];
  for (let i = 0; i < obj.namedChildCount; i++) {
    const pair = obj.namedChild(i);
    if (pair?.type !== 'pair') continue;
    const v = pair.childForFieldName('value');
    if (v?.type === 'string') out.push(v.text.slice(1, -1));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function collectStringArrayLiterals(node: SyntaxNode): string[] {
  if (node.type !== 'array') return [];
  const out: string[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c?.type === 'string') out.push(c.text.slice(1, -1));
  }
  return out;
}

function collectArgs(callNode: SyntaxNode): SyntaxNode[] {
  const list = callNode.childForFieldName('arguments');
  if (!list) return [];
  const out: SyntaxNode[] = [];
  for (let i = 0; i < list.namedChildCount; i++) {
    const c = list.namedChild(i);
    if (c) out.push(c);
  }
  return out;
}

/**
 * For anonymous calls (z.enum / z.union not assigned to a variable),
 * try to read the parent declarator's name. Falls back to undefined.
 */
function inferNameFromContext(callNode: SyntaxNode): string | undefined {
  let p: SyntaxNode | null = callNode.parent;
  while (p) {
    if (p.type === 'variable_declarator') {
      return p.childForFieldName('name')?.text ?? undefined;
    }
    if (p.type === 'pair') {
      const k = p.childForFieldName('key');
      if (k?.type === 'property_identifier' || k?.type === 'identifier') return k.text;
      if (k?.type === 'string') return k.text.slice(1, -1);
    }
    // Stop walking past statement boundaries.
    if (p.type === 'statement_block' || p.type === 'program') break;
    p = p.parent;
  }
  return undefined;
}

function mkEnum(
  name: string,
  values: string[],
  shape: EnumShape,
  node: SyntaxNode,
  filePath: string,
): ExtractedEnum {
  return {
    name,
    values: [...new Set(values)].sort(),
    shape,
    source: {
      filePath,
      lineStart: node.startPosition.row + 1,
      lineEnd: node.endPosition.row + 1,
    },
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
