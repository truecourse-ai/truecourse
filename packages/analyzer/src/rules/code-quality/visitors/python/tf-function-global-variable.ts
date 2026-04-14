import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonDecoratorFullName } from '../../../_shared/python-helpers.js'

/**
 * Detects @tf.function decorated functions that depend on global Python variables
 * (captured from enclosing scope) which causes unexpected behavior.
 */
export const pythonTfFunctionGlobalVariableVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/tf-function-global-variable',
  languages: ['python'],
  nodeTypes: ['decorated_definition'],
  visit(node, filePath, sourceCode) {
    const decorators = node.namedChildren.filter((c) => c.type === 'decorator')
    const hasTfFunction = decorators.some((d) => getPythonDecoratorFullName(d) === 'tf.function')
    if (!hasTfFunction) return null

    const funcNode = node.namedChildren.find((c) => c.type === 'function_definition' || c.type === 'async_function_definition')
    if (!funcNode) return null

    // Check for global statement inside
    const body = funcNode.childForFieldName('body')
    if (!body) return null

    function hasGlobalStatement(n: typeof node): boolean {
      if (n.type === 'global_statement') return true
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && hasGlobalStatement(child)) return true
      }
      return false
    }

    if (!hasGlobalStatement(body)) return null

    const nameNode = funcNode.childForFieldName('name')
    const funcName = nameNode?.text ?? 'function'

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      '@tf.function depends on global variable',
      `\`@tf.function\` decorated function \`${funcName}\` uses \`global\` — depending on global Python variables causes unexpected behavior during retracing.`,
      sourceCode,
      'Pass global state as function arguments instead of using global variables.',
    )
  },
}
