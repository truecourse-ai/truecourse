import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const PYTHON_OS_EXEC_METHODS = new Set(['execl', 'execle', 'execlp', 'execlpe', 'execv', 'execve', 'execvp', 'execvpe'])

export const pythonPartialPathExecutionVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/partial-path-execution',
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

    if (objectName !== 'os' || !PYTHON_OS_EXEC_METHODS.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    if (firstArg.type === 'string') {
      const cmd = firstArg.text.replace(/['"]/g, '')
      if (!cmd.startsWith('/') && !cmd.startsWith('C:\\')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Partial path execution',
          `os.${methodName}() uses relative path "${cmd}". A malicious PATH could substitute a different binary.`,
          sourceCode,
          'Use the full path to the executable (e.g., "/usr/bin/ls").',
        )
      }
    }

    return null
  },
}
