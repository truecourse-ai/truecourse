import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const awsIamPrivilegeEscalationVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-iam-privilege-escalation',
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

    if (ctorName !== 'PolicyStatement' && ctorName !== 'ManagedPolicy') return null

    const nodeText = node.text

    // Detect iam:* action
    if (/actions\s*:\s*\[[^\]]*['"]iam:\*['"][^\]]*\]/.test(nodeText) ||
        /actions\s*:\s*\[[^\]]*['"]sts:AssumeRole['"][^\]]*\]/.test(nodeText)) {
      // Check if resources is also broad (*)
      const hasBroadResources = /resources\s*:\s*\[[^\]]*['"][*]['"][^\]]*\]/.test(nodeText)
      if (hasBroadResources || /actions\s*:\s*\[[^\]]*['"]iam:\*['"][^\]]*\]/.test(nodeText)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'IAM privilege escalation',
          `new ${ctorName}() grants IAM privilege escalation actions (iam:* or sts:AssumeRole) with broad scope.`,
          sourceCode,
          'Restrict IAM actions to the minimum required. Never grant iam:* in production policies.',
        )
      }
    }

    return null
  },
}
