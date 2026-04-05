import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonProcessStartNoShellVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/process-start-no-shell',
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

    // Flag if first arg is a string (not a list) — indicating shell command as string
    if (firstArg.type === 'string' || firstArg.type === 'concatenated_string') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Subprocess with string command',
        'subprocess.Popen() with a string argument may invoke the shell implicitly. Use a list of arguments instead.',
        sourceCode,
        'Pass command as a list: subprocess.Popen(["cmd", "arg1", "arg2"]).',
      )
    }

    return null
  },
}
