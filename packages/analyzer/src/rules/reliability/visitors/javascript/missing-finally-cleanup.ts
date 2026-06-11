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
      // Require a real identifier boundary before the method name so we match
      // whole identifiers only. `\b` treats `$` as a boundary, which wrongly
      // matches managed-client methods like Prisma's `$connect()` as the raw
      // `connect()` resource-open. `$` is a JS identifier char, so exclude it.
      if (new RegExp(`(?<![\\w$])${method}\\s*\\(`).test(bodyText)) {
        // Skip createServer with .listen() — server lifecycle, not resource leak
        if (method === 'createServer' && bodyText.includes('.listen')) continue
        // Skip 'connect' and 'open' when called as method on existing object (pool/managed resource)
        if ((method === 'connect' || method === 'open') && new RegExp(`\\.\\s*${method}\\s*\\(`).test(bodyText)) continue
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
