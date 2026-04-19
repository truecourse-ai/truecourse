import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

const ARRAY_CALLBACK_METHODS = new Set([
  'map', 'filter', 'reduce', 'reduceRight', 'find', 'findIndex', 'some', 'every', 'flatMap', 'findLast', 'findLastIndex',
])

function hasReturn(n: SyntaxNode): boolean {
  if (n.type === 'return_statement' && n.namedChildren.length > 0) return true
  if (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function' || n.type === 'function_expression') return false
  for (let i = 0; i < n.childCount; i++) {
    const child = n.child(i)
    if (child && hasReturn(child)) return true
  }
  return false
}

export const arrayCallbackMissingReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/array-callback-missing-return',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null
    const prop = fn.childForFieldName('property')
    if (!prop || !ARRAY_CALLBACK_METHODS.has(prop.text)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null
    const firstArg = args.namedChildren[0]
    if (!firstArg) return null
    if (firstArg.type !== 'arrow_function' && firstArg.type !== 'function' && firstArg.type !== 'function_expression') return null

    const body = firstArg.childForFieldName('body')
    if (!body || body.type !== 'statement_block') return null

    if (!hasReturn(body)) {
      return makeViolation(
        this.ruleKey, firstArg, filePath, 'high',
        'Array callback missing return',
        `The callback passed to \`.${prop.text}()\` has no \`return\` statement — it always returns \`undefined\`.`,
        sourceCode,
        `Add a \`return\` statement to the \`.${prop.text}()\` callback.`,
      )
    }
    return null
  },
}
