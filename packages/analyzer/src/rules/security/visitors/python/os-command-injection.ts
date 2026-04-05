import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const PYTHON_SUBPROCESS_METHODS = new Set(['call', 'run', 'Popen', 'check_output', 'check_call'])
const PYTHON_OS_EXEC = new Set(['system', 'popen'])

export const pythonOsCommandInjectionVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/os-command-injection',
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

    // os.system(), os.popen()
    if (objectName === 'os' && PYTHON_OS_EXEC.has(methodName)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'critical',
        'OS command injection risk',
        `os.${methodName}() executes shell commands and is vulnerable to injection.`,
        sourceCode,
        'Use subprocess.run() with a list of arguments instead of os.system/popen.',
      )
    }

    // subprocess.call/run/Popen with shell=True
    if ((objectName === 'subprocess' && PYTHON_SUBPROCESS_METHODS.has(methodName)) ||
        PYTHON_SUBPROCESS_METHODS.has(methodName)) {
      const args = node.childForFieldName('arguments')
      if (args) {
        for (const arg of args.namedChildren) {
          if (arg.type === 'keyword_argument') {
            const name = arg.childForFieldName('name')
            const value = arg.childForFieldName('value')
            if (name?.text === 'shell' && value?.text === 'True') {
              return makeViolation(
                this.ruleKey, node, filePath, 'critical',
                'OS command injection risk',
                `${objectName ? objectName + '.' : ''}${methodName}() with shell=True is vulnerable to injection.`,
                sourceCode,
                'Remove shell=True and pass command as a list of arguments.',
              )
            }
          }
        }
      }
    }

    return null
  },
}
