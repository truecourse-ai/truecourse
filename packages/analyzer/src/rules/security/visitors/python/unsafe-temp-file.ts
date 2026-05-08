import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const PYTHON_UNSAFE_TEMPFILE_FUNCTIONS = new Set(['mktemp'])

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

    // \`tempfile.NamedTemporaryFile(delete=False)\` is the secure
    // stdlib helper for creating a uniquely-named temp file with
    // proper permissions; \`delete=False\` is for "preserve across
    // close()" use cases (handing the path to a child process,
    // long-running write phases). Not a security issue.

    return null
  },
}
