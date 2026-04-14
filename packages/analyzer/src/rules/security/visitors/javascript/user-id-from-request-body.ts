import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const userIdFromRequestBodyVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/user-id-from-request-body',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['member_expression'],
  visit(node, filePath, sourceCode) {
    // Detect req.body.userId, req.body.user_id, req.body.id patterns
    const obj = node.childForFieldName('object')
    const prop = node.childForFieldName('property')

    if (!obj || !prop) return null

    const propText = prop.text.toLowerCase()
    if (propText !== 'userid' && propText !== 'user_id' && propText !== 'accountid' && propText !== 'account_id') return null

    if (obj.type === 'member_expression') {
      const outerObj = obj.childForFieldName('object')
      const outerProp = obj.childForFieldName('property')
      if (outerObj?.text === 'req' && outerProp?.text === 'body') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'User ID from request body',
          `Using ${node.text} as user identity. Client-supplied IDs can be forged.`,
          sourceCode,
          'Use the authenticated user identity from req.user or the session token instead of req.body.',
        )
      }
    }

    return null
  },
}
