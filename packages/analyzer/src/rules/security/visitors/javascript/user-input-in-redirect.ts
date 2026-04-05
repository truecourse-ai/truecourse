import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const userInputInRedirectVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/user-input-in-redirect',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) methodName = prop.text
    }

    if (methodName !== 'redirect') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check all arguments for user input
    for (const arg of args.namedChildren) {
      const argText = arg.text.toLowerCase()
      if (argText.includes('req.') || argText.includes('params') ||
          argText.includes('query') || argText.includes('body') ||
          argText.includes('userinput') || argText.includes('user_input') ||
          argText.includes('returnurl') || argText.includes('return_url') ||
          argText.includes('redirecturl') || argText.includes('redirect_url')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'User input in redirect URL',
          'res.redirect() called with user-controlled URL. This allows open redirect attacks.',
          sourceCode,
          'Validate redirect URLs against an allowlist of trusted domains before redirecting.',
        )
      }
    }

    return null
  },
}
