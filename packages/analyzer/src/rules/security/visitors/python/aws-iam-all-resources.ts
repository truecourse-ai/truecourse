import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAwsIamAllResourcesVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-iam-all-resources-python',
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
        if (name?.text === 'resources' && value) {
          const valText = value.text
          if (valText.includes('"*"') || valText.includes("'*'")) {
            return makeViolation(
              this.ruleKey, node, filePath, 'critical',
              'IAM grants access to all resources',
              'IAM PolicyStatement with resources=["*"] applies to every resource in the account.',
              sourceCode,
              'Scope resources to specific ARNs instead of using wildcard "*".',
            )
          }
        }
      }
    }

    return null
  },
}
