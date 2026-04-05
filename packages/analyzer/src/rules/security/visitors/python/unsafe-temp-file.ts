import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const PYTHON_UNSAFE_TEMPFILE_FUNCTIONS = new Set(['mktemp', 'NamedTemporaryFile'])

export const pythonUnsafeTempFileVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unsafe-temp-file',
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

    // tempfile.mktemp() — insecure, race condition
    if (methodName === 'mktemp' && (objectName === 'tempfile' || objectName === '')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Unsafe temporary file creation',
        'tempfile.mktemp() is deprecated and insecure due to a TOCTOU race condition.',
        sourceCode,
        'Use tempfile.mkstemp() or tempfile.NamedTemporaryFile() instead.',
      )
    }

    // tempfile.NamedTemporaryFile(delete=False) without mode restriction
    if (methodName === 'NamedTemporaryFile' && (objectName === 'tempfile' || objectName === '')) {
      const args = node.childForFieldName('arguments')
      if (args) {
        let hasDeleteFalse = false
        for (const arg of args.namedChildren) {
          if (arg.type === 'keyword_argument') {
            const name = arg.childForFieldName('name')
            const value = arg.childForFieldName('value')
            if (name?.text === 'delete' && value?.text === 'False') {
              hasDeleteFalse = true
            }
          }
        }
        if (hasDeleteFalse) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Unsafe temporary file creation',
            'NamedTemporaryFile(delete=False) creates a persistent temp file that may not be cleaned up securely.',
            sourceCode,
            'Ensure the file is deleted securely after use, or use tempfile.mkstemp() and manage cleanup yourself.',
          )
        }
      }
    }

    return null
  },
}
