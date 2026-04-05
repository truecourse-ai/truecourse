import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const s3MissingBucketOwnerVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/s3-missing-bucket-owner',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) methodName = prop.text
    }

    if (methodName !== 'putBucketAcl' && methodName !== 'putObject' && methodName !== 'createBucket') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'object') {
        const keys = arg.namedChildren
          .filter((c) => c.type === 'pair')
          .map((c) => c.childForFieldName('key')?.text?.replace(/['"]/g, '') ?? '')
        if (!keys.includes('ExpectedBucketOwner')) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'S3 operation without bucket owner check',
            `${methodName}() called without ExpectedBucketOwner, which can allow confused deputy attacks.`,
            sourceCode,
            'Add ExpectedBucketOwner to S3 operations to prevent confused deputy attacks.',
          )
        }
      }
    }

    return null
  },
}
