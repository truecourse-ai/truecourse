import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const noScriptUrlVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-script-url',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['string', 'template_string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    if (/javascript\s*:/i.test(text)) {
      // Skip when the string is used in a comparison/check (e.g., url.startsWith('javascript:'))
      // These are defensive checks, not actual javascript: URL usage
      const parent = node.parent
      if (parent?.type === 'arguments') {
        const callExpr = parent.parent
        if (callExpr?.type === 'call_expression') {
          const fn = callExpr.childForFieldName('function')
          if (fn?.type === 'member_expression') {
            const method = fn.childForFieldName('property')?.text
            if (method === 'startsWith' || method === 'includes' || method === 'indexOf' || method === 'test' || method === 'match') {
              return null
            }
          }
        }
      }
      // Skip in if conditions (comparison context)
      if (parent?.type === 'binary_expression') return null

      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Script URL',
        '`javascript:` URLs are a form of eval. Use event handlers instead.',
        sourceCode,
        'Replace javascript: URL with an event handler or proper navigation.',
      )
    }
    return null
  },
}
