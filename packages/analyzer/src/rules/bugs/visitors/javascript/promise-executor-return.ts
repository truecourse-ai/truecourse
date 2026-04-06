import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const promiseExecutorReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/promise-executor-return',
  languages: JS_LANGUAGES,
  nodeTypes: ['new_expression'],
  visit(node, filePath, sourceCode) {
    const constructor = node.childForFieldName('constructor')
    if (!constructor || constructor.text !== 'Promise') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const executor = args.namedChildren[0]
    if (!executor) return null

    let body: SyntaxNode | null = null
    if (executor.type === 'arrow_function' || executor.type === 'function') {
      body = executor.childForFieldName('body')
    }
    if (!body || body.type !== 'statement_block') return null

    for (const child of body.namedChildren) {
      if (child.type === 'return_statement' && child.namedChildren.length > 0) {
        return makeViolation(
          this.ruleKey, child, filePath, 'medium',
          'Promise executor return',
          'Returning a value from a Promise executor function has no effect — the return value is ignored. Use `resolve(value)` instead.',
          sourceCode,
          'Replace `return value` with `resolve(value)` in the Promise executor.',
        )
      }
    }
    return null
  },
}
