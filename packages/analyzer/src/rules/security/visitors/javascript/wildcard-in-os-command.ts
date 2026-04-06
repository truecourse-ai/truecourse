import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const EXEC_METHODS = new Set(['exec', 'execSync'])

export const wildcardInOsCommandVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/wildcard-in-os-command',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) methodName = prop.text
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    if (!EXEC_METHODS.has(methodName) && methodName !== 'execFile' && methodName !== 'execFileSync') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const argText = firstArg.text
    // Check for wildcard in a shell command string
    if ((firstArg.type === 'string' || firstArg.type === 'template_string') && /\*/.test(argText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Wildcard in OS command',
        `Glob wildcard (*) in OS command "${argText}" can be exploited via specially named files.`,
        sourceCode,
        'Avoid wildcards in shell commands. Enumerate files explicitly or use a library.',
      )
    }

    return null
  },
}
