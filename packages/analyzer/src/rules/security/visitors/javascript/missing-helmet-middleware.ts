import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const missingHelmetMiddlewareVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/missing-helmet-middleware',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Detect express() initialization
    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    }

    if (funcName !== 'express') return null

    // Look at the surrounding block for app.use(helmet())
    let parent = node.parent
    let blockText = ''
    while (parent) {
      if (parent.type === 'program' || parent.type === 'module') {
        blockText = parent.text
        break
      }
      parent = parent.parent
    }

    if (blockText && !blockText.includes('helmet')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Missing helmet middleware',
        'Express app initialized without helmet middleware. Security headers are not set.',
        sourceCode,
        'Add helmet: app.use(helmet()) to set security headers.',
      )
    }

    return null
  },
}
