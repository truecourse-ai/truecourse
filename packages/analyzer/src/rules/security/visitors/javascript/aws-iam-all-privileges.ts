import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const awsIamAllPrivilegesVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-iam-all-privileges',
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
    // actions: ['*'] or actions: ["*"]
    if (/actions\s*:\s*\[[^\]]*['"][*]['"][^\]]*\]/.test(nodeText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'critical',
        'IAM grants all privileges',
        `new ${ctorName}() with actions: ["*"] grants every possible AWS action.`,
        sourceCode,
        'Restrict actions to only those explicitly required by the resource.',
      )
    }

    return null
  },
}
