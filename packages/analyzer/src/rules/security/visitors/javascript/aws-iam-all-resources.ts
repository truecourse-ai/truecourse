import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const awsIamAllResourcesVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-iam-all-resources',
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

    if (ctorName !== 'PolicyStatement') return null

    const nodeText = node.text
    // resources: ['*'] or resources: ["*"]
    if (/resources\s*:\s*\[[^\]]*['"][*]['"][^\]]*\]/.test(nodeText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'critical',
        'IAM grants access to all resources',
        `new ${ctorName}() with resources: ["*"] applies to every resource in the AWS account.`,
        sourceCode,
        'Scope resources to specific ARNs instead of using wildcard "*".',
      )
    }

    return null
  },
}
