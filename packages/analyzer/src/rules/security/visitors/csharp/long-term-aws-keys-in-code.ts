import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { staticStringText } from './_helpers.js'

/**
 * AWS long-term credentials in source: an AKIA access-key-ID literal, or a
 * 20+ char literal assigned to an awsSecretKey-style variable.
 */
const AWS_KEY_PATTERN = /^AKIA[0-9A-Z]{16}$/
const AWS_SECRET_NAMES = new Set(['awssecretaccesskey', 'awssecretkey', 'secretaccesskey', 'awssecret'])

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[_-]/g, '')
}

export const csharpLongTermAwsKeysInCodeVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/long-term-aws-keys-in-code',
  languages: ['csharp'],
  nodeTypes: ['string_literal', 'verbatim_string_literal'],
  visit(node, filePath, sourceCode) {
    const value = staticStringText(node)

    if (AWS_KEY_PATTERN.test(value)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'critical',
        'AWS access keys hardcoded',
        `Hardcoded AWS access key ID detected ("${value}").`,
        sourceCode,
        'Remove the key; use IAM roles, AWS profiles, or environment variables.',
      )
    }

    // var awsSecretKey = "..." / AwsSecretKey = "..."
    const parent = node.parent
    if (parent && value.length >= 20) {
      let name = ''
      if (parent.type === 'variable_declarator') {
        name = parent.namedChildren[0]?.text ?? ''
      } else if (parent.type === 'assignment_expression') {
        const left = parent.childForFieldName('left') ?? parent.namedChildren[0]
        name = left && left.id !== node.id ? (left.type === 'member_access_expression' ? left.childForFieldName('name')?.text ?? '' : left.text) : ''
      } else if (parent.type === 'equals_value_clause') {
        name = parent.parent?.namedChildren[0]?.text ?? ''
      }
      if (name && AWS_SECRET_NAMES.has(normalizeName(name))) {
        return makeViolation(
          this.ruleKey, node, filePath, 'critical',
          'AWS access keys hardcoded',
          `AWS secret key assigned to "${name}" as a hardcoded string.`,
          sourceCode,
          'Use environment variables (AWS_SECRET_ACCESS_KEY), AWS profiles, or an IAM role.',
        )
      }
    }

    return null
  },
}
