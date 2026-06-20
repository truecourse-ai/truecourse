import type { Node as SyntaxNode } from 'web-tree-sitter'
import { hasCSharpModifier, isCSharpStringNode, getCSharpStringText } from '../../../_shared/csharp-helpers.js'

/**
 * The single character of a one-character non-interpolated string literal
 * (`"a"` → 'a'), or null. Interpolated/raw strings and escape sequences longer
 * than one source character are rejected so callers only match literals a
 * `char` overload could replace.
 */
export function singleCharStringLiteral(node: SyntaxNode): string | null {
  if (!isCSharpStringNode(node)) return null
  if (node.type === 'interpolated_string_expression' || node.type === 'raw_string_literal') return null
  const text = getCSharpStringText(node)
  if (text === null) return null
  // Reject escapes (\n, \t, \\, A): a one-char overload only helps for a
  // genuine single character, and escape handling here would be error-prone.
  if (text.length !== 1 || text === '\\') return null
  return text
}

export const CSHARP_LOOP_TYPES = new Set([
  'for_statement',
  'foreach_statement',
  'while_statement',
  'do_statement',
])

const FUNCTION_BOUNDARY_TYPES = new Set([
  'method_declaration',
  'local_function_statement',
  'constructor_declaration',
  'lambda_expression',
  'anonymous_method_expression',
  'accessor_declaration',
])

/** True when the node sits inside a loop within the same method/lambda. */
export function isInsideCSharpLoop(node: SyntaxNode): boolean {
  return findEnclosingCSharpLoop(node) !== null
}

/** The innermost enclosing loop within the same method/lambda, or null. */
export function findEnclosingCSharpLoop(node: SyntaxNode): SyntaxNode | null {
  let current = node.parent
  while (current) {
    if (CSHARP_LOOP_TYPES.has(current.type)) return current
    if (FUNCTION_BOUNDARY_TYPES.has(current.type)) return null
    current = current.parent
  }
  return null
}

/**
 * True when any enclosing method/local function/lambda carries the `async`
 * modifier. Deliberately does NOT stop at the first non-async boundary: a
 * synchronous lambda inside an async method still executes on the async path.
 */
export function isInsideCSharpAsyncContext(node: SyntaxNode): boolean {
  let current = node.parent
  while (current) {
    if (FUNCTION_BOUNDARY_TYPES.has(current.type) && hasCSharpModifier(current, 'async')) {
      return true
    }
    current = current.parent
  }
  return false
}

/**
 * Leftmost expression of a member-access / invocation / element-access chain:
 * `_db.Orders.Where(p).ToList()` → the `_db` identifier node.
 */
export function getCSharpChainRoot(node: SyntaxNode): SyntaxNode {
  let current = node
  for (;;) {
    if (current.type === 'invocation_expression') {
      const fn = current.childForFieldName('function')
      if (!fn) return current
      current = fn
      continue
    }
    if (current.type === 'member_access_expression' || current.type === 'element_access_expression') {
      const expr = current.childForFieldName('expression')
      if (!expr) return current
      current = expr
      continue
    }
    return current
  }
}

/**
 * The receiver's *simple* (rightmost) name for a member call:
 * `System.Threading.Tasks.Task.WhenAll(...)` → 'Task', `_db.Save()` → '_db'.
 * Returns '' when the call has no member-access receiver.
 */
export function getCSharpReceiverSimpleName(invocation: SyntaxNode): string {
  const fn = invocation.childForFieldName('function')
  if (fn?.type !== 'member_access_expression') return ''
  const receiver = fn.childForFieldName('expression')
  if (!receiver) return ''
  if (receiver.type === 'member_access_expression') {
    return receiver.childForFieldName('name')?.text ?? ''
  }
  if (receiver.type === 'qualified_name') {
    return receiver.childForFieldName('name')?.text ?? ''
  }
  return receiver.text
}

/** Simple name of an object-creation type: `System.Threading.Timer` → 'Timer'. */
export function getCSharpSimpleTypeName(typeNode: SyntaxNode | null): string {
  if (!typeNode) return ''
  if (typeNode.type === 'qualified_name') {
    return typeNode.childForFieldName('name')?.text ?? ''
  }
  if (typeNode.type === 'generic_name') {
    return typeNode.namedChildren.find((c) => c?.type === 'identifier')?.text ?? ''
  }
  return typeNode.text
}

function patternBindsName(pattern: SyntaxNode, name: string): boolean {
  if (pattern.type === 'identifier') return pattern.text === name
  let found = false
  for (const child of pattern.namedChildren) {
    if (child && patternBindsName(child, name)) found = true
  }
  return found
}

function declaresLocal(scope: SyntaxNode, name: string): boolean {
  if (scope.type === 'variable_declarator' && scope.childForFieldName('name')?.text === name) {
    return true
  }
  for (const child of scope.namedChildren) {
    // Don't descend into nested functions — their locals are theirs
    if (!child || FUNCTION_BOUNDARY_TYPES.has(child.type)) continue
    if (declaresLocal(child, name)) return true
  }
  return false
}

/**
 * True when `name` changes per loop iteration as seen from `node`: it is a
 * loop variable (foreach binding, for-initializer variable) of any enclosing
 * loop, or a local declared inside an enclosing loop body.
 */
export function isCSharpLoopScopedIdentifier(node: SyntaxNode, name: string): boolean {
  let current = node.parent
  while (current) {
    if (current.type === 'foreach_statement') {
      const left = current.childForFieldName('left')
      if (left && patternBindsName(left, name)) return true
    }
    if (current.type === 'for_statement') {
      const init = current.childForFieldName('initializer')
      if (init && declaresLocal(init, name)) return true
    }
    if (CSHARP_LOOP_TYPES.has(current.type)) {
      const body = current.childForFieldName('body')
      if (body && declaresLocal(body, name)) return true
    }
    if (FUNCTION_BOUNDARY_TYPES.has(current.type)) return false
    current = current.parent
  }
  return false
}

/**
 * Statements of a loop body, whether it is a block or a single inlined
 * statement (`foreach (var x in xs) seen.Add(x);`). Comments excluded.
 */
export function getCSharpLoopBodyStatements(loop: SyntaxNode): SyntaxNode[] {
  const body = loop.childForFieldName('body')
  if (!body) return []
  if (body.type === 'block') {
    return body.namedChildren.filter((c): c is SyntaxNode => !!c && c.type !== 'comment')
  }
  return [body]
}
