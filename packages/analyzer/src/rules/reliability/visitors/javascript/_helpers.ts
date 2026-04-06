import type { SyntaxNode } from 'tree-sitter'

/** Check if a node is inside a try block (direct child of try_statement body). */
export function isInsideTryCatch(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'try_statement') return true
    current = current.parent
  }
  return false
}

/** Check if a call_expression has a .catch() chained after it (or is inside .then().catch()). */
export function hasCatchChain(node: SyntaxNode): boolean {
  // Walk up through member_expression -> call_expression chains
  let current: SyntaxNode | null = node
  while (current) {
    const p: SyntaxNode | null = current.parent
    if (!p) break
    // If parent is member_expression with property .catch or .then
    if (p.type === 'member_expression') {
      const prop = p.childForFieldName('property')
      if (prop?.text === 'catch') return true
    }
    // If parent is call_expression wrapping a member access, keep walking up
    if (p.type === 'call_expression' || p.type === 'member_expression') {
      current = p
    } else {
      break
    }
  }
  return false
}

export function findContainingStatement(node: SyntaxNode): SyntaxNode | null {
  let current: SyntaxNode | null = node
  while (current) {
    if (current.type === 'expression_statement' || current.type === 'lexical_declaration' || current.type === 'variable_declaration') {
      return current
    }
    current = current.parent
  }
  return null
}

export function findEnclosingFunction(node: SyntaxNode): SyntaxNode | null {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (
      current.type === 'arrow_function' ||
      current.type === 'function_declaration' ||
      current.type === 'function' ||
      current.type === 'method_definition'
    ) {
      return current
    }
    current = current.parent
  }
  return null
}

export function isInsidePromiseConstructor(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'new_expression') {
      const ctor = current.childForFieldName('constructor')
      if (ctor?.text === 'Promise') return true
    }
    current = current.parent
  }
  return false
}
