import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const TIMEOUT_PARAM_NAMES = new Set(['timeout', 'deadline', 'time_limit', 'max_time', 'wait_timeout'])

export const pythonAsyncFunctionWithTimeoutVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/async-function-with-timeout',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    // Check if it's async
    const isAsync = node.children.some((c) => c.type === 'async' || c.text === 'async')
    if (!isAsync) return null

    const params = node.childForFieldName('parameters')
    if (!params) return null

    // Check if any parameter looks like a timeout parameter
    for (const param of params.namedChildren) {
      let paramName: string | null = null

      if (param.type === 'identifier') {
        paramName = param.text
      } else if (param.type === 'default_parameter' || param.type === 'typed_parameter') {
        const nameNode = param.childForFieldName('name') ?? param.namedChildren[0]
        if (nameNode?.type === 'identifier') paramName = nameNode.text
      } else if (param.type === 'typed_default_parameter') {
        const nameNode = param.childForFieldName('name')
        if (nameNode?.type === 'identifier') paramName = nameNode.text
      }

      if (paramName && TIMEOUT_PARAM_NAMES.has(paramName)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Async function accepting timeout parameter',
          `Async function \`${node.childForFieldName('name')?.text}\` uses a \`${paramName}\` parameter — async code should use deadline/cancel scope patterns (e.g., asyncio.wait_for, trio.move_on_after) instead of passing timeouts manually.`,
          sourceCode,
          `Use \`asyncio.wait_for(coro, timeout=${paramName})\` or a cancel scope library instead of accepting a timeout parameter.`,
        )
      }
    }

    return null
  },
}
