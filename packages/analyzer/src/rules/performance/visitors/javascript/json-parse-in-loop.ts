import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInsideLoop } from './_helpers.js'
import { containsIdentifierExact } from '../../../_shared/javascript-helpers.js'

export const jsonParseInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/json-parse-in-loop',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')
    if (obj?.text !== 'JSON') return null
    if (prop?.text !== 'parse' && prop?.text !== 'stringify') return null

    if (!isInsideLoop(node)) return null

    // Skip when the argument is dynamic per iteration — only flag when the same
    // static value is parsed/stringified repeatedly. The walk handles unwrapping
    // ternary / parenthesized / binary expressions so a per-iteration value
    // wrapped in `cond ? x : {}` is still recognised as dynamic.
    const args = node.childForFieldName('arguments')
    const firstArg = args?.namedChildren[0]
    if (firstArg && isDynamicPerIteration(firstArg, node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      `JSON.${prop.text}() inside loop`,
      `JSON.${prop.text}() is expensive and calling it inside a loop degrades performance. Move it outside the loop if possible.`,
      sourceCode,
      `Cache the result of JSON.${prop.text}() outside the loop.`,
    )
  },
}

function isDynamicPerIteration(arg: SyntaxNode, callNode: SyntaxNode): boolean {
  switch (arg.type) {
    case 'parenthesized_expression': {
      const inner = arg.namedChildren[0]
      return inner ? isDynamicPerIteration(inner, callNode) : false
    }
    case 'call_expression':
    case 'subscript_expression':
    case 'template_string':
      return true
    case 'ternary_expression': {
      const cons = arg.childForFieldName('consequence')
      const alt = arg.childForFieldName('alternative')
      return (!!cons && isDynamicPerIteration(cons, callNode)) ||
             (!!alt && isDynamicPerIteration(alt, callNode))
    }
    case 'binary_expression': {
      const left = arg.childForFieldName('left')
      const right = arg.childForFieldName('right')
      return (!!left && isDynamicPerIteration(left, callNode)) ||
             (!!right && isDynamicPerIteration(right, callNode))
    }
    case 'identifier':
      return isLoopBoundIdentifier(arg.text, callNode)
    case 'member_expression': {
      const inner = arg.childForFieldName('object')
      if (!inner) return false
      if (inner.type === 'identifier') return isLoopBoundIdentifier(inner.text, callNode)
      return isDynamicPerIteration(inner, callNode)
    }
    default:
      return false
  }
}

function isLoopBoundIdentifier(varName: string, callNode: SyntaxNode): boolean {
  let current: SyntaxNode | null = callNode.parent
  let innermostLoop: SyntaxNode | null = null
  while (current) {
    if (current.type === 'for_in_statement' || current.type === 'for_of_statement') {
      const left = current.childForFieldName('left')
      if (left && containsIdentifierExact(left, varName)) return true
      if (!innermostLoop) innermostLoop = current
    }
    if (current.type === 'for_statement') {
      const init = current.childForFieldName('initializer')
      if (init && containsIdentifierExact(init, varName)) return true
      if (!innermostLoop) innermostLoop = current
    }
    if (current.type === 'while_statement' || current.type === 'do_statement') {
      if (!innermostLoop) innermostLoop = current
    }
    // .forEach / .map callback parameter (matches the original behaviour:
    // a callback param of a chained collection method counts as a loop var).
    if (current.type === 'arrow_function' || current.type === 'function_expression' || current.type === 'function') {
      const params = current.childForFieldName('parameters')
      if (params && containsIdentifierExact(params, varName)) {
        const callParent = current.parent?.parent
        if (callParent?.type === 'call_expression') return true
      }
    }
    current = current.parent
  }
  if (innermostLoop) {
    const body = innermostLoop.childForFieldName('body')
    if (body && containsBindingInBlock(body, varName)) return true
  }
  return false
}

/**
 * Walk a block looking for a `let`/`const`/`var` binding of `varName`.
 * Stops at nested function / class boundaries (those introduce their own
 * scope, so a binding inside a closure is not the same variable as one
 * referenced from outside that closure).
 */
function containsBindingInBlock(node: SyntaxNode, varName: string): boolean {
  if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
    for (const decl of node.namedChildren) {
      if (decl.type === 'variable_declarator') {
        const name = decl.childForFieldName('name')
        if (name && containsIdentifierExact(name, varName)) return true
      }
    }
    return false
  }
  if (
    node.type === 'function_declaration' ||
    node.type === 'arrow_function' ||
    node.type === 'function' ||
    node.type === 'function_expression' ||
    node.type === 'method_definition' ||
    node.type === 'class_declaration'
  ) {
    return false
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && containsBindingInBlock(child, varName)) return true
  }
  return false
}
