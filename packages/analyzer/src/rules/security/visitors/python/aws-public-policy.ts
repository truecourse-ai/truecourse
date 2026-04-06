import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAwsPublicPolicyVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-public-policy',
  languages: ['python'],
  nodeTypes: ['string'],
  visit(node, filePath, sourceCode) {
    const val = node.text.replace(/^[rRbBuU]*['"`]{1,3}|['"`]{1,3}$/g, '')

    // JSON policy string with Principal: "*"
    if ((val.includes('"Principal"') || val.includes("'Principal'")) &&
        (val.includes('"*"') || val.includes("'*'"))) {
      return makeViolation(
        this.ruleKey, node, filePath, 'critical',
        'Public AWS resource policy',
        'AWS policy string contains Principal: "*", granting public access to this resource.',
        sourceCode,
        'Restrict the Principal to specific accounts or IAM roles.',
      )
    }

    return null
  },
}

export const pythonAwsPublicResourceVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-public-resource-python',
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

    const PUBLIC_RESOURCE_CONSTRUCTS = new Set([
      'CfnDBInstance', 'DatabaseInstance', 'CfnInstance',
      'CfnReplicationInstance', 'Instance',
    ])

    if (!PUBLIC_RESOURCE_CONSTRUCTS.has(funcName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if ((name?.text === 'publicly_accessible' || name?.text === 'multi_az') &&
            value?.text === 'True') {
          if (name.text === 'publicly_accessible') {
            return makeViolation(
              this.ruleKey, node, filePath, 'high',
              'Public cloud resource',
              `${funcName}() created with publicly_accessible=True. The instance is exposed to the internet.`,
              sourceCode,
              'Set publicly_accessible=False and use a private VPC with a bastion host or VPN.',
            )
          }
        }
      }
    }

    return null
  },
}
