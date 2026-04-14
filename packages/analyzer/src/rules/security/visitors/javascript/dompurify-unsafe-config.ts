import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const UNSAFE_DOMPURIFY_OPTIONS = new Set(['ALLOW_UNKNOWN_PROTOCOLS', 'ADD_TAGS', 'ADD_ATTR'])

export const dompurifyUnsafeConfigVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/dompurify-unsafe-config',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    let objectName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      const obj = fn.childForFieldName('object')
      if (prop) methodName = prop.text
      if (obj) objectName = obj.text
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    if (methodName !== 'sanitize') return null
    if (objectName !== 'DOMPurify' && objectName !== 'dompurify') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'object') {
        for (const prop of arg.namedChildren) {
          if (prop.type === 'pair') {
            const key = prop.childForFieldName('key')
            if (key && UNSAFE_DOMPURIFY_OPTIONS.has(key.text)) {
              return makeViolation(
                this.ruleKey, node, filePath, 'high',
                'DOMPurify unsafe configuration',
                `DOMPurify.sanitize() with ${key.text} weakens sanitization and may allow XSS.`,
                sourceCode,
                'Remove unsafe DOMPurify options like ALLOW_UNKNOWN_PROTOCOLS and ADD_TAGS.',
              )
            }
          }
        }
      }
    }

    return null
  },
}
