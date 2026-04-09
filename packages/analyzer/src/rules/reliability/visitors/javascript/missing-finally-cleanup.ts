import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const RESOURCE_OPEN_METHODS = new Set([
  'createConnection', 'connect', 'createPool', 'open',
  'createReadStream', 'createWriteStream', 'createServer',
])

export const missingFinallyCleanupVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/missing-finally-cleanup',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['try_statement'],
  visit(node, filePath, sourceCode) {
    // Check if the try_statement has a finally clause
    const hasFinally = node.namedChildren.some((c) => c.type === 'finally_clause')
    if (hasFinally) return null

    // Check the try body for resource-opening calls
    const body = node.childForFieldName('body')
    if (!body) return null
    const bodyText = body.text

    for (const method of RESOURCE_OPEN_METHODS) {
      if (bodyText.includes(method)) {
        // Skip createServer with .listen() — server lifecycle, not resource leak
        if (method === 'createServer' && bodyText.includes('.listen')) continue
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Missing finally cleanup for resource',
          `Resource opened with ${method}() in try block without a finally clause for cleanup.`,
          sourceCode,
          'Add a finally block to close/release the resource, or use a using/await using declaration.',
        )
      }
    }

    return null
  },
}
