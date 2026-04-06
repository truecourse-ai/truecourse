import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const JS_LOG_METHODS = new Set(['log', 'info', 'warn', 'error', 'debug', 'trace'])
const SENSITIVE_VAR_PATTERNS = /(?:password|passwd|secret|token|apiKey|api_key|private_key|privateKey|credential|mnemonic)/i

export const confidentialInfoLoggingVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/confidential-info-logging',
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
    }

    if (!JS_LOG_METHODS.has(methodName)) return null
    if (objectName !== 'console' && objectName !== 'logger' && objectName !== 'log') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'identifier' && SENSITIVE_VAR_PATTERNS.test(arg.text)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Confidential info logging',
          `Logging sensitive variable "${arg.text}". This may expose secrets in logs.`,
          sourceCode,
          'Remove sensitive data from log statements or redact it.',
        )
      }
      if (arg.type === 'member_expression') {
        const prop = arg.childForFieldName('property')
        if (prop && SENSITIVE_VAR_PATTERNS.test(prop.text)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Confidential info logging',
            `Logging sensitive property "${prop.text}". This may expose secrets in logs.`,
            sourceCode,
            'Remove sensitive data from log statements or redact it.',
          )
        }
      }
    }

    return null
  },
}
