import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonSubprocessWithoutShellVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/subprocess-without-shell',
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

    const SUBPROCESS_CALL_METHODS = new Set(['call', 'run', 'check_output', 'check_call'])
    if (objectName !== 'subprocess' || !SUBPROCESS_CALL_METHODS.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // Flag when first argument is a variable (could be user-controlled), not a literal list
    if (firstArg.type === 'identifier') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Subprocess call without shell review',
        `subprocess.${methodName}() called with a variable argument. If the value contains user input, shell injection is possible.`,
        sourceCode,
        'Ensure the command is not built from user input. Use a literal list of arguments.',
      )
    }

    return null
  },
}
