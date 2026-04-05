import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const awsPublicResourceVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-public-resource',
  languages: ['typescript', 'javascript'],
  nodeTypes: ['pair'],
  visit(node, filePath, sourceCode) {
    const key = node.childForFieldName('key')
    const value = node.childForFieldName('value')

    const keyText = key?.text?.replace(/['"]/g, '')
    if ((keyText === 'publiclyAccessible' || keyText === 'multiAz') && value?.text === 'true') {
      if (keyText === 'publiclyAccessible') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Public cloud resource',
          'publiclyAccessible: true exposes this AWS resource to the public internet.',
          sourceCode,
          'Set publiclyAccessible to false and use a VPC with private subnets.',
        )
      }
    }

    return null
  },
}
