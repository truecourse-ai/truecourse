import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_FUNCTION_BOUNDARIES } from '../../../bugs/visitors/csharp/_helpers.js'

/**
 * `return` of a variable that was declared by the enclosing `using` statement.
 * The using block disposes that variable as the method returns, so the caller
 * receives an already-disposed object. The classic shape is:
 *
 *   using (var conn = Open()) { return conn; }
 *
 * Precision: we only flag a return whose value is exactly the using-declared
 * identifier (or a member/cast of it). Returning a *different* object built
 * from the resource (`return reader.ReadToEnd();`) is correct and not flagged.
 */
function collectUsingVariableNames(usingStmt: SyntaxNode): Set<string> {
  const names = new Set<string>()
  const decl = usingStmt.namedChildren.find((c) => c?.type === 'variable_declaration')
  if (!decl) return names
  for (const declarator of decl.namedChildren) {
    if (declarator?.type !== 'variable_declarator') continue
    const id = declarator.namedChildren[0]
    if (id?.type === 'identifier') names.add(id.text)
  }
  return names
}

/** The using's body block, or null for a resource-less / non-block using. */
function usingBody(usingStmt: SyntaxNode): SyntaxNode | null {
  return usingStmt.namedChildren.find((c) => c?.type === 'block') ?? null
}

/** Root identifier of a returned expression: `conn`, `conn.Inner`, `(IFoo)conn` → 'conn'. */
function returnedRootIdentifier(expr: SyntaxNode): string | null {
  let current: SyntaxNode | null = expr
  while (current) {
    if (current.type === 'identifier') return current.text
    if (current.type === 'member_access_expression') {
      current = current.childForFieldName('expression')
      continue
    }
    if (current.type === 'cast_expression') {
      current = current.childForFieldName('value') ?? current.namedChildren[current.namedChildCount - 1] ?? null
      continue
    }
    if (current.type === 'parenthesized_expression') {
      current = current.namedChildren[0] ?? null
      continue
    }
    return null
  }
  return null
}

function findReturnOfName(node: SyntaxNode, names: Set<string>): SyntaxNode | null {
  if (node.type === 'return_statement') {
    const value = node.namedChildren[0]
    if (value) {
      const root = returnedRootIdentifier(value)
      if (root && names.has(root)) return node
    }
    return null
  }
  // A nested using that re-binds the same name owns its own resource.
  if (node.type === 'using_statement') return null
  for (const child of node.namedChildren) {
    if (!child || CSHARP_FUNCTION_BOUNDARIES.has(child.type)) continue
    const found = findReturnOfName(child, names)
    if (found) return found
  }
  return null
}

export const csharpReturnDisposableFromUsingVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/return-disposable-from-using',
  languages: ['csharp'],
  nodeTypes: ['using_statement'],
  visit(node, filePath, sourceCode) {
    const names = collectUsingVariableNames(node)
    if (names.size === 0) return null

    const body = usingBody(node)
    if (!body) return null

    const ret = findReturnOfName(body, names)
    if (!ret) return null

    return makeViolation(
      this.ruleKey, ret, filePath, 'high',
      'Returning a disposable from its own using block',
      'The returned object was declared by the enclosing using statement, so it is disposed as the method returns. The caller receives an already-disposed object and any use of it throws ObjectDisposedException.',
      sourceCode,
      'Do not wrap the object in using when you intend to hand it to the caller — let the caller own and dispose it (return it from a plain declaration), or return a copy of the data instead of the resource.',
    )
  },
}
