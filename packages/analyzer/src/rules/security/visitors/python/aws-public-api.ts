import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAwsPublicApiVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-public-api-python',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    } else if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) funcName = attr.text
    }

    if (funcName !== 'RestApi' && funcName !== 'HttpApi' && funcName !== 'CfnRestApi') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check for default_method_options with authorization_type=NONE or missing
    const nodeText = node.text
    if (/authorization_type.*NONE/i.test(nodeText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Public API Gateway',
        `${funcName}() configured with authorization_type=NONE. The API is publicly accessible without authentication.`,
        sourceCode,
        'Configure an authorizer (Cognito, Lambda, or IAM) for the API Gateway.',
      )
    }

    return null
  },
}
