import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const awsUnencryptedEfsVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-unencrypted-efs',
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

    if (ctorName !== 'FileSystem' && ctorName !== 'CfnFileSystem') return null

    const nodeText = node.text
    if (/encrypted\s*:\s*false/i.test(nodeText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unencrypted EFS file system',
        `new ${ctorName}() created with encrypted: false. File system data at rest is unprotected.`,
        sourceCode,
        'Set encrypted: true on the EFS FileSystem construct.',
      )
    }

    return null
  },
}
