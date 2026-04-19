import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

function findCookieOptionsObject(node: import('web-tree-sitter').Node): import('web-tree-sitter').Node | null {
  const fn = node.childForFieldName('function')
  if (!fn) return null

  let methodName = ''
  if (fn.type === 'member_expression') {
    const prop = fn.childForFieldName('property')
    if (prop) methodName = prop.text
  }

  if (methodName !== 'cookie') return null

  const args = node.childForFieldName('arguments')
  if (!args || args.namedChildren.length < 3) return null

  const optionsArg = args.namedChildren[2]
  if (optionsArg?.type === 'object') return optionsArg

  return null
}

function objectHasProperty(objectNode: import('web-tree-sitter').Node, propName: string, propValue: string): boolean {
  for (const child of objectNode.namedChildren) {
    if (child.type === 'pair') {
      const key = child.childForFieldName('key')
      const value = child.childForFieldName('value')
      if (key?.text === propName && value?.text === propValue) return true
    }
  }
  return false
}

export const insecureCookieVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/insecure-cookie',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const optionsObj = findCookieOptionsObject(node)
    if (!optionsObj) return null

    if (!objectHasProperty(optionsObj, 'secure', 'true')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Insecure cookie',
        'Cookie set without the secure flag. It may be transmitted over unencrypted HTTP.',
        sourceCode,
        'Add secure: true to the cookie options.',
      )
    }

    return null
  },
}

export const cookieWithoutHttpOnlyVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/cookie-without-httponly',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const optionsObj = findCookieOptionsObject(node)
    if (!optionsObj) return null

    if (!objectHasProperty(optionsObj, 'httpOnly', 'true')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Cookie without httpOnly',
        'Cookie set without the httpOnly flag. It can be accessed by client-side JavaScript.',
        sourceCode,
        'Add httpOnly: true to the cookie options.',
      )
    }

    return null
  },
}
