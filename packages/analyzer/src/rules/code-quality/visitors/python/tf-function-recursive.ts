import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects @tf.function decorated functions that call themselves recursively —
 * causes retracing on each call.
 */
export const pythonTfFunctionRecursiveVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/tf-function-recursive',
  languages: ['python'],
  nodeTypes: ['decorated_definition'],
  visit(node, filePath, sourceCode) {
    // Check decorators for @tf.function
    const decorators = node.namedChildren.filter((c) => c.type === 'decorator')
    const hasTfFunction = decorators.some((d) => d.text === '@tf.function' || d.text.includes('tf.function'))
    if (!hasTfFunction) return null

    const funcNode = node.namedChildren.find((c) => c.type === 'function_definition' || c.type === 'async_function_definition')
    if (!funcNode) return null

    const nameNode = funcNode.childForFieldName('name')
    if (!nameNode) return null
    const funcName = nameNode.text

    const body = funcNode.childForFieldName('body')
    if (!body) return null

    // Check if body contains a call to the function itself
    const bodyText = body.text
    const callPattern = new RegExp(`\\b${funcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`)
    if (!callPattern.test(bodyText)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Recursive @tf.function',
      `\`@tf.function\` decorated function \`${funcName}\` calls itself recursively — this causes retracing on each call and poor performance.`,
      sourceCode,
      'Refactor to avoid recursion in @tf.function, or use an iterative approach.',
    )
  },
}
