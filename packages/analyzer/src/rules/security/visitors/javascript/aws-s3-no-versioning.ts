import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const awsS3NoVersioningVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-s3-no-versioning',
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

    if (ctorName !== 'Bucket') return null

    const nodeText = node.text

    // Only check if this looks like an S3 CDK Bucket
    if (!/versioned|removalPolicy|encryption|blockPublicAccess|enforceSSL/i.test(nodeText) &&
        !/s3\.|S3\.|aws-s3/i.test(nodeText)) {
      return null
    }

    if (/versioned\s*:\s*false/.test(nodeText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'S3 bucket without versioning',
        'S3 Bucket created with versioned: false. Object versions cannot be recovered after deletion or overwrite.',
        sourceCode,
        'Set versioned: true to enable versioning and protect against accidental deletion.',
      )
    }

    if (!/versioned/.test(nodeText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'S3 bucket without versioning',
        'S3 Bucket created without enabling versioning. Objects cannot be recovered after deletion.',
        sourceCode,
        'Add versioned: true to the S3 Bucket construct.',
      )
    }

    return null
  },
}
