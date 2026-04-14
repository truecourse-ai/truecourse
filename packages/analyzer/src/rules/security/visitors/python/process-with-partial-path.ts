import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonProcessWithPartialPathVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/process-with-partial-path',
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

    const SUBPROCESS_METHODS = new Set(['call', 'run', 'Popen', 'check_output', 'check_call'])
    if (objectName !== 'subprocess' || !SUBPROCESS_METHODS.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // If it's a list, check the first element
    if (firstArg.type === 'list') {
      const firstElem = firstArg.namedChildren[0]
      if (firstElem && firstElem.type === 'string') {
        const cmd = firstElem.text.replace(/['"]/g, '')
        if (!cmd.startsWith('/') && !cmd.startsWith('C:\\') && cmd.length > 0 &&
            !cmd.startsWith('python') && !cmd.startsWith('./')) {
          // Only flag short command names (no path separators)
          if (!cmd.includes('/') && !cmd.includes('\\')) {
            return makeViolation(
              this.ruleKey, node, filePath, 'medium',
              'Process started with partial path',
              `subprocess.${methodName}() uses relative command "${cmd}". A malicious PATH entry could execute a different binary.`,
              sourceCode,
              'Use the full path to the executable, e.g. "/usr/bin/python3".',
            )
          }
        }
      }
    }

    return null
  },
}
