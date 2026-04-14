import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'
import { containsPythonIdentifierExact } from '../../../_shared/python-helpers.js'

/** Check if a node (possibly a dict) contains a "NONE" value — as identifier, string, or dict entry. */
function containsNoneValue(node: SyntaxNode): boolean {
  if (containsPythonIdentifierExact(node, 'NONE')) return true
  if (node.type === 'string' && node.text.replace(/['"]/g, '') === 'NONE') return true
  // Walk into dicts: check pairs for authorization_type key with NONE value
  if (node.type === 'dictionary') {
    for (const child of node.namedChildren) {
      if (child.type === 'pair') {
        const key = child.childForFieldName('key')
        const val = child.childForFieldName('value')
        if (key?.text.replace(/['"]/g, '') === 'authorization_type' && val) {
          if (val.type === 'string' && val.text.replace(/['"]/g, '') === 'NONE') return true
          if (containsPythonIdentifierExact(val, 'NONE')) return true
        }
      }
    }
  }
  for (const child of node.namedChildren) {
    if (containsNoneValue(child)) return true
  }
  return false
}

export const pythonAwsPublicApiVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-public-api-python',
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

    if (funcName !== 'RestApi' && funcName !== 'HttpApi' && funcName !== 'CfnRestApi') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Walk keyword arguments looking for authorization_type=NONE
    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (name?.text === 'authorization_type' && value) {
          if (containsNoneValue(value)) {
            return makeViolation(
              this.ruleKey, node, filePath, 'high',
              'Public API Gateway',
              `${funcName}() configured with authorization_type=NONE. The API is publicly accessible without authentication.`,
              sourceCode,
              'Configure an authorizer (Cognito, Lambda, or IAM) for the API Gateway.',
            )
          }
        }
        // Also check nested dicts like default_method_options={authorization_type: NONE}
        if ((name?.text === 'default_method_options' || name?.text === 'default_authorization') && value) {
          if (containsNoneValue(value)) {
            return makeViolation(
              this.ruleKey, node, filePath, 'high',
              'Public API Gateway',
              `${funcName}() configured with authorization_type=NONE. The API is publicly accessible without authentication.`,
              sourceCode,
              'Configure an authorizer (Cognito, Lambda, or IAM) for the API Gateway.',
            )
          }
        }
      }
    }

    return null
  },
}
