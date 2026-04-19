import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const noPromiseExecutorReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/no-promise-executor-return',
  languages: JS_LANGUAGES,
  nodeTypes: ['new_expression'],
  visit(node, filePath, sourceCode) {
    const constructor = node.childForFieldName('constructor')
    if (!constructor || constructor.text !== 'Promise') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const executor = args.namedChildren[0]
    if (!executor) return null

    // executor is arrow_function or function (anonymous)
    let body: SyntaxNode | null = null
    if (executor.type === 'arrow_function' || executor.type === 'function') {
      body = executor.childForFieldName('body')
    }
    if (!body) return null

    // For arrow functions with expression body, the return is implicit — skip
    if (body.type !== 'statement_block') return null

    // Look for direct return statements with a value
    for (const child of body.namedChildren) {
      if (child.type === 'return_statement') {
        const returnChildren = child.namedChildren
        if (returnChildren.length > 0) {
          return makeViolation(
            this.ruleKey, child, filePath, 'high',
            'Promise executor return',
            'Returning a value from a Promise executor has no effect — use `resolve(value)` instead.',
            sourceCode,
            'Replace `return value` with `resolve(value)` to fulfill the promise.',
          )
        }
      }
    }
    return null
  },
}
