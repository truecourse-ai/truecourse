import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonNonOctalFilePermissionsVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/non-octal-file-permissions',
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

    if (methodName !== 'chmod') return null
    if (objectName !== 'os') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Second arg is the mode
    const modeArg = args.namedChildren[1]
    if (!modeArg) return null

    if (modeArg.type === 'integer') {
      const text = modeArg.text
      // If it's a decimal number (not starting with 0o, 0x, 0b) and common permission values
      if (!text.startsWith('0o') && !text.startsWith('0O') && !text.startsWith('0x') && !text.startsWith('0b')) {
        const num = parseInt(text, 10)
        // Common mistaken decimal permissions: 777, 755, 644, 666, etc.
        if (num >= 100 && num <= 777) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Non-octal file permissions',
            `os.chmod() called with decimal ${text} instead of octal 0o${text}. Decimal ${text} is octal ${num.toString(8)}, which is likely not the intended permission.`,
            sourceCode,
            `Use octal notation: os.chmod(path, 0o${text}).`,
          )
        }
      }
    }

    return null
  },
}
