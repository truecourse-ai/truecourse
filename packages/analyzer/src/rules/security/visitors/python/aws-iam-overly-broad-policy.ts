import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Check if a node is or contains a string literal whose content is just "*". */
function containsWildcardStringLiteral(node: SyntaxNode): boolean {
  if (node.type === 'string') {
    const stripped = node.text.replace(/^['"]|['"]$/g, '')
    return stripped === '*'
  }
  for (const child of node.namedChildren) {
    if (containsWildcardStringLiteral(child)) return true
  }
  return false
}

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
          // actions=["*"] or actions="*" — check for string literal containing just "*"
          if (containsWildcardStringLiteral(value)) {
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
          // actions=["*"] or actions="*" — check for string literal containing just "*"
          if (containsWildcardStringLiteral(value)) {
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
