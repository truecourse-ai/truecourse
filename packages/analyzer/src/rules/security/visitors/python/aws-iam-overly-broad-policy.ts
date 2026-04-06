import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAwsIamOverlyBroadPolicyVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-iam-overly-broad-policy',
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

    if (funcName !== 'PolicyStatement' && funcName !== 'ManagedPolicy') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (name?.text === 'actions' && value) {
          const valText = value.text
          // actions=["*"] or actions="*"
          if (valText.includes('"*"') || valText.includes("'*'")) {
            return makeViolation(
              this.ruleKey, node, filePath, 'critical',
              'Overly broad IAM policy',
              'IAM PolicyStatement with actions="*" grants every possible AWS action.',
              sourceCode,
              'List only the specific actions required by the role or user.',
            )
          }
        }
      }
    }

    return null
  },
}

export const pythonAwsIamAllPrivilegesVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-iam-all-privileges-python',
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

    if (funcName !== 'PolicyStatement') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (name?.text === 'actions' && value) {
          const valText = value.text
          if (valText.includes('"*"') || valText.includes("'*'")) {
            return makeViolation(
              this.ruleKey, node, filePath, 'critical',
              'IAM grants all privileges',
              'IAM PolicyStatement with actions=["*"] grants all AWS privileges.',
              sourceCode,
              'Restrict actions to only those explicitly required.',
            )
          }
        }
      }
    }

    return null
  },
}
