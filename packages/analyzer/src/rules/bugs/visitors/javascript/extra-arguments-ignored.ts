import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const extraArgumentsIgnoredVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/extra-arguments-ignored',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Only handle IIFE patterns and inline function literals
    let funcNode: SyntaxNode | null = null
    if (fn.type === 'arrow_function' || fn.type === 'function') {
      funcNode = fn
    } else if (fn.type === 'parenthesized_expression') {
      const inner = fn.namedChildren[0]
      if (inner?.type === 'arrow_function' || inner?.type === 'function') {
        funcNode = inner
      }
    }

    if (!funcNode) return null

    const params = funcNode.childForFieldName('parameters')
    if (!params) return null

    // Count required params (excluding rest parameters)
    const paramNodes = params.namedChildren
    const hasRest = paramNodes.some(
      (p) =>
        p.type === 'rest_parameter' ||
        p.type === 'rest_element' ||
        p.type === 'rest_pattern' ||
        // TypeScript: required_parameter wrapping rest_pattern
        p.namedChildren.some((c) => c.type === 'rest_pattern') ||
        p.text.startsWith('...'),
    )
    if (hasRest) return null // rest accepts any number

    const paramCount = paramNodes.length

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argCount = args.namedChildren.length

    if (argCount > paramCount) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Extra arguments ignored',
        `Function has ${paramCount} parameter${paramCount === 1 ? '' : 's'} but is called with ${argCount} argument${argCount === 1 ? '' : 's'} — the extra ${argCount - paramCount} argument${argCount - paramCount === 1 ? ' is' : 's are'} silently ignored.`,
        sourceCode,
        'Remove the extra arguments or update the function signature to accept them.',
      )
    }
    return null
  },
}
