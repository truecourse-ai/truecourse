import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { containsPythonIdentifierExact } from '../../../_shared/python-helpers.js'

export const pythonAwsS3NoVersioningVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-s3-no-versioning-python',
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

    if (funcName !== 'Bucket' && funcName !== 'CfnBucket') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Walk keyword arguments for versioning configuration
    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (!name || !value) continue

        const keyName = name.text
        if (keyName === 'versioning' || keyName === 'versioning_configuration' ||
            keyName === 'versioned' || keyName === 'VersioningConfiguration') {
          // Check for Suspended/disabled status — as identifier, string, or inside a dict
          const valText = value.type === 'string' ? value.text.replace(/['"]/g, '').toLowerCase() : ''
          const hasSuspended = containsPythonIdentifierExact(value, 'Suspended') ||
              containsPythonIdentifierExact(value, 'SUSPENDED') ||
              containsPythonIdentifierExact(value, 'DISABLED') ||
              value.text === 'False' ||
              valText === 'suspended' || valText === 'disabled' ||
              (value.type === 'dictionary' && value.namedChildren.some(p =>
                p.type === 'pair' && (p.childForFieldName('value')?.text.replace(/['"]/g, '').toLowerCase() === 'suspended')))
          if (hasSuspended) {
            return makeViolation(
              this.ruleKey, node, filePath, 'medium',
              'S3 bucket without versioning',
              `${funcName}() configured with versioning suspended. Objects cannot be recovered after accidental deletion.`,
              sourceCode,
              'Enable versioning: set versioning=BucketVersioning.ENABLED.',
            )
          }
        }
      }
    }

    return null
  },
}
