import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const PASSWORD_FUNCTION_NAMES = /(?:login|authenticate|connect|bind|createConnection|createClient|auth|verify|checkPassword|comparePassword)/i
const PLAINTEXT_PASSWORD_PATTERN = /^[a-zA-Z0-9!@#$%^&*()_+\-=[\]{};':",.<>?/\\|`~]{8,}$/

export const hardcodedPasswordFunctionArgVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/hardcoded-password-function-arg',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    } else if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) funcName = prop.text
    }

    if (!PASSWORD_FUNCTION_NAMES.test(funcName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'string') {
        const val = arg.text.replace(/['"]/g, '')
        if (val.length >= 8 && PLAINTEXT_PASSWORD_PATTERN.test(val) &&
            !/^https?:\/\//.test(val) && !/localhost/.test(val)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Hardcoded password as function argument',
            `${funcName}() called with a hardcoded string that looks like a password.`,
            sourceCode,
            'Move credentials to environment variables and reference them via process.env.',
          )
        }
      }
    }

    return null
  },
}
