import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const HEAVYWEIGHT_RESOURCES = new Set([
  // DB clients
  'pymysql', 'psycopg2', 'pymongo', 'redis', 'elasticsearch',
  // AWS clients
  'boto3',
  // HTTP clients
  'requests', 'httpx', 'aiohttp',
  // Other
  'openai', 'anthropic',
])

/**
 * Detects initialization of heavyweight resources (DB connections, API clients)
 * inside Lambda handler functions instead of at module level.
 */
export const pythonLambdaInitResourcesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/lambda-init-resources',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const nameNode = node.childForFieldName('name')
    if (!nameNode) return null

    // Lambda handler functions are named `handler` or `lambda_handler`
    const name = nameNode.text
    if (name !== 'handler' && name !== 'lambda_handler' && !name.endsWith('_handler')) return null

    // Check parameters — Lambda handlers have (event, context)
    const params = node.childForFieldName('parameters')
    if (!params) return null
    const paramTexts = params.namedChildren.map((c) => c.text)
    if (!paramTexts.some((p) => p === 'event' || p.includes('event'))) return null
    if (!paramTexts.some((p) => p === 'context' || p.includes('context'))) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Look for resource initialization inside the handler body
    for (const child of body.namedChildren) {
      if (child.type !== 'expression_statement' && child.type !== 'assignment') continue

      const childText = child.text
      for (const resource of HEAVYWEIGHT_RESOURCES) {
        if (childText.includes(resource + '.client') || childText.includes(resource + '.connect') || childText.includes(resource + '.Client') || childText.includes(`import ${resource}`) || (resource === 'boto3' && childText.includes('boto3.client('))) {
          return makeViolation(
            this.ruleKey, child, filePath, 'medium',
            'Lambda resources not initialized at construction',
            `Heavyweight resource (\`${resource}\`) initialized inside Lambda handler — move initialization to module level to reuse across invocations.`,
            sourceCode,
            'Move resource initialization (clients, connections) to module level outside the handler function.',
          )
        }
      }
    }

    return null
  },
}
