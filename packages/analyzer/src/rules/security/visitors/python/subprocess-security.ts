import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonSubprocessSecurityVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/subprocess-security',
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
    }

    if (objectName !== 'subprocess' || methodName !== 'Popen') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // Check if first arg is a list with a non-absolute-path first element
    if (firstArg.type === 'list') {
      const firstElem = firstArg.namedChildren[0]
      if (firstElem && firstElem.type === 'string') {
        const cmd = firstElem.text.replace(/['"]/g, '')
        if (!cmd.startsWith('/') && !cmd.startsWith('C:\\')) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Subprocess without full path',
            `subprocess.Popen() uses relative command "${cmd}". A malicious PATH could substitute a different binary.`,
            sourceCode,
            'Use the full path to the executable (e.g., "/usr/bin/ls").',
          )
        }
      }
    }

    return null
  },
}
