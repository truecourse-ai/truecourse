import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const asyncPromiseExecutorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/async-promise-executor',
  languages: JS_LANGUAGES,
  nodeTypes: ['new_expression'],
  visit(node, filePath, sourceCode) {
    const constructor = node.childForFieldName('constructor')
    if (!constructor || constructor.text !== 'Promise') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const executor = args.namedChildren[0]
    if (!executor) return null

    // Check if executor is async
    if (executor.type === 'arrow_function' || executor.type === 'function') {
      const isAsync = executor.children.some((c) => c.text === 'async')
      if (isAsync) {
        return makeViolation(
          this.ruleKey, executor, filePath, 'high',
          'Async Promise executor',
          'Promise executor should not be async — errors thrown in an async executor are swallowed and not passed to reject.',
          sourceCode,
          'Remove `async` from the executor or handle errors with try/catch and call reject().',
        )
      }
    }
    return null
  },
}
