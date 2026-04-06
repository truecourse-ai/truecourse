import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const PYTHON_LOG_METHODS = new Set(['info', 'warning', 'error', 'debug', 'critical', 'log'])
const PYTHON_SENSITIVE_PATTERN = /(?:password|passwd|secret|token|api_key|private_key|credential|mnemonic)/i

export const pythonConfidentialInfoLoggingVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/confidential-info-logging',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    let objectName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      const obj = fn.childForFieldName('object')
      if (attr) methodName = attr.text
      if (obj) objectName = obj.text
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    const isPrint = methodName === 'print'
    const isLogging = PYTHON_LOG_METHODS.has(methodName) && (objectName === 'logging' || objectName === 'logger' || objectName === 'log')

    if (!isPrint && !isLogging) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'identifier' && PYTHON_SENSITIVE_PATTERN.test(arg.text)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Confidential info logging',
          `Logging sensitive variable "${arg.text}". This may expose secrets in logs.`,
          sourceCode,
          'Remove sensitive data from log statements or redact it.',
        )
      }
      if (arg.type === 'attribute') {
        const attrChild = arg.childForFieldName('attribute')
        if (attrChild && PYTHON_SENSITIVE_PATTERN.test(attrChild.text)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Confidential info logging',
            `Logging sensitive attribute "${attrChild.text}". This may expose secrets in logs.`,
            sourceCode,
            'Remove sensitive data from log statements or redact it.',
          )
        }
      }
    }

    return null
  },
}
