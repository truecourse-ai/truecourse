import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const awsPublicApiVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-public-api',
  languages: ['typescript', 'javascript'],
  nodeTypes: ['new_expression'],
  visit(node, filePath, sourceCode) {
    const ctor = node.childForFieldName('constructor')
    if (!ctor) return null

    let ctorName = ''
    if (ctor.type === 'identifier') {
      ctorName = ctor.text
    } else if (ctor.type === 'member_expression') {
      const prop = ctor.childForFieldName('property')
      if (prop) ctorName = prop.text
    }

    if (ctorName !== 'RestApi' && ctorName !== 'HttpApi' && ctorName !== 'LambdaRestApi') return null

    // Check if defaultMethodOptions with authorizationType is absent or NONE
    const nodeText = node.text
    if (/authorizationType.*AuthorizationType\.NONE/i.test(nodeText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Public API Gateway',
        `new ${ctorName}() configured with AuthorizationType.NONE. The API accepts unauthenticated requests.`,
        sourceCode,
        'Configure an authorizer (Cognito, Lambda, or IAM) for the API Gateway.',
      )
    }

    return null
  },
}
