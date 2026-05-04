import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'

// ---------------------------------------------------------------------------
// Tree-sitter helpers for the state-machine plugin (TS / TSX only)
// ---------------------------------------------------------------------------
//
// v1 covers:
//   • String-literal union type aliases  (`type X = 'a' | 'b' | 'c'`)
//   • Direct field assignments           (`obj.field = 'literal'`)
//   • Object-literal initializers in `new T(...)` / `return {...}` (initial)
//   • `if (x.field === 'literal')` and disjunctive variants — write inside
//     the consequent
//
// Out of scope for v1 (callers handle absence as "no inference"):
//   • TS `enum`, Zod `z.enum`, Prisma `enum`
//   • `switch`, negation (`!==`), early-return guards, alias tracking
//   • Spread updates, `Object.assign`
//   • ORM `update({ data })`, `set({ ... })`, raw SQL UPDATE
// ---------------------------------------------------------------------------

export interface UnionTypeDecl {
  /** Type alias name (e.g. `Status`). */
  name: string
  /** Closed set of string-literal members. */
  states: string[]
  /** 1-indexed line of the `type X = ...` declaration. */
  line: number
}

export type WriteSiteKind = 'assignment' | 'initial'

export interface WriteSite {
  kind: WriteSiteKind
  /** Identifier the write targets (e.g. `step` in `step.status = 'x'`). null for initial-shape writes. */
  receiver: string | null
  /** Property name (e.g. `status`). */
  field: string
  /** The string-literal value being assigned. null when assignment isn't a literal — caller skips. */
  value: string | null
  /** AST node for the assignment / property pair (used for guard inference). */
  node: SyntaxNode
  /** 1-indexed lines covering the write expression. */
  lineStart: number
  lineEnd: number
}

export type PriorInference =
  | { kind: 'guarded'; priors: string[] }
  | { kind: 'unguarded' }
  | { kind: 'initial' }

// ---------------------------------------------------------------------------
// 1. Find string-literal union type aliases
// ---------------------------------------------------------------------------
//
// Matches `type X = 'a' | 'b' | 'c'` (any number of literals, must all be
// string literals). Skips union types that include non-literal members.
// Tree-sitter shape:
//   type_alias_declaration
//     name: type_identifier
//     value: union_type
//       types: [literal_type { string | string_fragment }, ...]
//
// A bare single-literal type alias (`type X = 'only'`) is also accepted —
// degenerate but still a closed set.
// ---------------------------------------------------------------------------

export function findStringLiteralUnions(tree: Tree, sourceCode: string): UnionTypeDecl[] {
  const out: UnionTypeDecl[] = []

  const visit = (node: SyntaxNode): void => {
    if (node.type === 'type_alias_declaration') {
      const decl = parseUnionTypeAlias(node, sourceCode)
      if (decl) out.push(decl)
    }
    for (const c of node.namedChildren) visit(c)
  }

  visit(tree.rootNode)
  return out
}

function parseUnionTypeAlias(node: SyntaxNode, sourceCode: string): UnionTypeDecl | null {
  const nameNode = node.childForFieldName('name')
  const valueNode = node.childForFieldName('value')
  if (!nameNode || !valueNode) return null

  const name = sourceCode.slice(nameNode.startIndex, nameNode.endIndex)
  const states: string[] = []
  if (!collectUnionLiterals(valueNode, sourceCode, states)) return null
  if (states.length === 0) return null
  return { name, states, line: node.startPosition.row + 1 }
}

/**
 * Walk a type expression, pushing every leaf string literal into `out`.
 * Returns false (and stops early) if any non-literal leaf is encountered —
 * the alias is then rejected as not a closed string-literal union.
 *
 * tree-sitter-typescript represents `'a' | 'b' | 'c'` as a left-leaning
 * binary tree of nested `union_type` nodes, so we recurse rather than
 * iterate a flat list.
 */
function collectUnionLiterals(
  node: SyntaxNode,
  sourceCode: string,
  out: string[],
): boolean {
  if (node.type === 'union_type') {
    for (const child of node.namedChildren) {
      if (!collectUnionLiterals(child, sourceCode, out)) return false
    }
    return true
  }
  const lit = readStringLiteralType(node, sourceCode)
  if (lit === null) return false
  out.push(lit)
  return true
}

function readStringLiteralType(node: SyntaxNode, sourceCode: string): string | null {
  if (node.type !== 'literal_type') return null
  // literal_type has one named child — the actual literal node.
  const inner = node.namedChildren[0]
  if (!inner) return null
  if (inner.type !== 'string') return null
  return readStringLiteral(inner, sourceCode)
}

function readStringLiteral(node: SyntaxNode, sourceCode: string): string | null {
  if (node.type !== 'string') return null
  // tree-sitter-typescript represents string content via a `string_fragment`
  // named child; absence means an empty string literal.
  const fragment = node.namedChildren.find((c) => c.type === 'string_fragment')
  if (!fragment) return ''
  return sourceCode.slice(fragment.startIndex, fragment.endIndex)
}

// ---------------------------------------------------------------------------
// 2. Find write sites for a given field name
// ---------------------------------------------------------------------------
//
// Two shapes recognized:
//   (a) Assignment:    `step.status = 'pending'`
//                      → assignment_expression with member_expression LHS
//   (b) Object literal: `{ status: 'pending', ... }` *iff* the literal is the
//       direct argument of `new X(...)`, the body of a `return`, or the
//       value of an `arrow_function` whose body is the literal expression.
//       These are treated as initial-state writes — no prior state exists.
// ---------------------------------------------------------------------------

export function findFieldWriteSites(
  tree: Tree,
  sourceCode: string,
  field: string,
): WriteSite[] {
  const out: WriteSite[] = []

  const visit = (node: SyntaxNode): void => {
    if (node.type === 'assignment_expression') {
      const site = parseAssignment(node, sourceCode, field)
      if (site) out.push(site)
    } else if (node.type === 'object' || node.type === 'object_pattern') {
      const sites = parseObjectLiteralInitial(node, sourceCode, field)
      out.push(...sites)
    }
    for (const c of node.namedChildren) visit(c)
  }

  visit(tree.rootNode)
  return out
}

function parseAssignment(
  node: SyntaxNode,
  sourceCode: string,
  field: string,
): WriteSite | null {
  const lhs = node.childForFieldName('left')
  const rhs = node.childForFieldName('right')
  if (!lhs || !rhs) return null
  if (lhs.type !== 'member_expression') return null

  const propNode = lhs.childForFieldName('property')
  const objNode = lhs.childForFieldName('object')
  if (!propNode || !objNode) return null

  const propName = sourceCode.slice(propNode.startIndex, propNode.endIndex)
  if (propName !== field) return null

  const receiver = objNode.type === 'identifier'
    ? sourceCode.slice(objNode.startIndex, objNode.endIndex)
    : null

  const value = rhs.type === 'string' ? readStringLiteral(rhs, sourceCode) : null

  return {
    kind: 'assignment',
    receiver,
    field,
    value,
    node,
    lineStart: node.startPosition.row + 1,
    lineEnd: node.endPosition.row + 1,
  }
}

function parseObjectLiteralInitial(
  objectNode: SyntaxNode,
  sourceCode: string,
  field: string,
): WriteSite[] {
  // Only treat as initial when the object literal sits inside a `new X(...)`,
  // a `return ...`, or an arrow body. Other contexts (function args in
  // arbitrary calls, generic object expressions) are out of v1 scope —
  // they're more often updates than initial writes.
  if (!isInitialContext(objectNode)) return []

  const out: WriteSite[] = []
  for (const child of objectNode.namedChildren) {
    if (child.type !== 'pair') continue
    const keyNode = child.childForFieldName('key')
    const valueNode = child.childForFieldName('value')
    if (!keyNode || !valueNode) continue

    const keyName = readPropertyKey(keyNode, sourceCode)
    if (keyName !== field) continue

    const value = valueNode.type === 'string'
      ? readStringLiteral(valueNode, sourceCode)
      : null

    out.push({
      kind: 'initial',
      receiver: null,
      field,
      value,
      node: child,
      lineStart: child.startPosition.row + 1,
      lineEnd: child.endPosition.row + 1,
    })
  }
  return out
}

function readPropertyKey(node: SyntaxNode, sourceCode: string): string | null {
  if (node.type === 'property_identifier' || node.type === 'identifier') {
    return sourceCode.slice(node.startIndex, node.endIndex)
  }
  if (node.type === 'string') {
    return readStringLiteral(node, sourceCode)
  }
  return null
}

function isInitialContext(node: SyntaxNode): boolean {
  let cur: SyntaxNode | null = node.parent
  // Skip transparent wrappers (parenthesized_expression, as_expression, …).
  while (cur && (cur.type === 'parenthesized_expression' || cur.type === 'as_expression' || cur.type === 'satisfies_expression')) {
    cur = cur.parent
  }
  if (!cur) return false
  if (cur.type === 'arguments') {
    // arguments → call_expression / new_expression — accept only `new T(...)`.
    return cur.parent?.type === 'new_expression'
  }
  if (cur.type === 'return_statement') return true
  if (cur.type === 'arrow_function') return true
  return false
}

// ---------------------------------------------------------------------------
// 3. Infer prior states from surrounding guards
// ---------------------------------------------------------------------------
//
// Walks up from a write site looking for the nearest enclosing `if_statement`
// whose consequent contains the write and whose condition narrows the field
// to a closed set of string literals. Recognized condition shapes:
//
//   x.field === 'literal'                    → priors = ['literal']
//   x.field === 'a' || x.field === 'b'      → priors = ['a', 'b']
//   x.field === 'a' || x.field === 'b' || …
//
// Returns:
//   { kind: 'guarded', priors }   — narrowing condition matched
//   { kind: 'unguarded' }          — no narrowing condition found
//   { kind: 'initial' }            — caller passes a `kind: 'initial'` site;
//                                    not produced by walking
// ---------------------------------------------------------------------------

export function inferPriorStates(
  site: WriteSite,
  sourceCode: string,
): PriorInference {
  if (site.kind === 'initial') return { kind: 'initial' }

  let cur: SyntaxNode | null = site.node
  while (cur) {
    const parent: SyntaxNode | null = cur.parent
    if (!parent) break
    if (parent.type === 'if_statement') {
      // Only treat as a guard when the write is inside the consequent
      // (the `then` branch), not the else branch or the condition itself.
      const consequent = parent.childForFieldName('consequence')
      if (consequent && nodeContains(consequent, cur)) {
        const condition = parent.childForFieldName('condition')
        if (condition) {
          const priors = readGuardCondition(condition, sourceCode, site.receiver, site.field)
          if (priors !== null) {
            return { kind: 'guarded', priors }
          }
        }
      }
    }
    cur = parent
  }
  return { kind: 'unguarded' }
}

function nodeContains(parent: SyntaxNode, child: SyntaxNode): boolean {
  return child.startIndex >= parent.startIndex && child.endIndex <= parent.endIndex
}

/**
 * Read an `if` condition. Strips the outer `parenthesized_expression`
 * wrapper, then expects either:
 *   • `x.field === 'literal'`         → ['literal']
 *   • OR-chain of the above           → flattened union
 * Anything else returns null (caller treats as unguarded).
 */
function readGuardCondition(
  condition: SyntaxNode,
  sourceCode: string,
  expectedReceiver: string | null,
  field: string,
): string[] | null {
  const inner = unwrapParens(condition)
  return collectOrChain(inner, sourceCode, expectedReceiver, field)
}

function unwrapParens(node: SyntaxNode): SyntaxNode {
  let cur = node
  while (cur.type === 'parenthesized_expression') {
    const child = cur.namedChildren[0]
    if (!child) break
    cur = child
  }
  return cur
}

function collectOrChain(
  node: SyntaxNode,
  sourceCode: string,
  expectedReceiver: string | null,
  field: string,
): string[] | null {
  const u = unwrapParens(node)
  if (u.type === 'binary_expression') {
    const opNode = u.childForFieldName('operator')
    const op = opNode ? sourceCode.slice(opNode.startIndex, opNode.endIndex) : ''
    if (op === '||') {
      const left = u.childForFieldName('left')
      const right = u.childForFieldName('right')
      if (!left || !right) return null
      const ls = collectOrChain(left, sourceCode, expectedReceiver, field)
      const rs = collectOrChain(right, sourceCode, expectedReceiver, field)
      if (ls === null || rs === null) return null
      return [...ls, ...rs]
    }
    if (op === '===' || op === '==') {
      return readEqualityClause(u, sourceCode, expectedReceiver, field)
    }
  }
  return null
}

function readEqualityClause(
  expr: SyntaxNode,
  sourceCode: string,
  expectedReceiver: string | null,
  field: string,
): string[] | null {
  const left = expr.childForFieldName('left')
  const right = expr.childForFieldName('right')
  if (!left || !right) return null

  // Either side may be the member access; literal is the other.
  const pair = matchMemberLiteralPair(left, right, sourceCode, expectedReceiver, field)
  if (!pair) return null
  return [pair.literal]
}

function matchMemberLiteralPair(
  a: SyntaxNode,
  b: SyntaxNode,
  sourceCode: string,
  expectedReceiver: string | null,
  field: string,
): { literal: string } | null {
  const memberFirst = readMemberAccess(a, sourceCode, expectedReceiver, field)
  if (memberFirst) {
    const lit = b.type === 'string' ? readStringLiteral(b, sourceCode) : null
    return lit !== null ? { literal: lit } : null
  }
  const memberSecond = readMemberAccess(b, sourceCode, expectedReceiver, field)
  if (memberSecond) {
    const lit = a.type === 'string' ? readStringLiteral(a, sourceCode) : null
    return lit !== null ? { literal: lit } : null
  }
  return null
}

function readMemberAccess(
  node: SyntaxNode,
  sourceCode: string,
  expectedReceiver: string | null,
  field: string,
): boolean {
  if (node.type !== 'member_expression') return false
  const obj = node.childForFieldName('object')
  const prop = node.childForFieldName('property')
  if (!obj || !prop) return false
  if (obj.type !== 'identifier') return false
  const propName = sourceCode.slice(prop.startIndex, prop.endIndex)
  if (propName !== field) return false
  if (expectedReceiver !== null) {
    const objName = sourceCode.slice(obj.startIndex, obj.endIndex)
    if (objName !== expectedReceiver) return false
  }
  return true
}
