import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonWildcardInOsCommandVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/wildcard-in-os-command',
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

    if (objectName !== 'os' || (methodName !== 'system' && methodName !== 'popen')) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const argText = firstArg.text
    if (/ \*/.test(argText) || /\*/.test(argText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Wildcard in OS command',
        `Glob wildcard (*) in os.${methodName}() command can be exploited via specially named files.`,
        sourceCode,
        'Avoid wildcards in shell commands. Enumerate files explicitly using os.listdir() or pathlib.',
      )
    }

    return null
  },
}
