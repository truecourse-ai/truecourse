import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const mixedHttpMethodsVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/mixed-http-methods',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    if (fn.type !== 'member_expression') return null
    const prop = fn.childForFieldName('property')
    if (!prop) return null

    if (prop.text !== 'all') return null

    const obj = fn.childForFieldName('object')
    if (!obj) return null

    const objText = obj.text
    if (!/(app|router|server|express)/.test(objText.toLowerCase())) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Route handling mixed HTTP methods',
      `${objText}.all() registers the route for all HTTP methods including GET, which should not trigger state changes.`,
      sourceCode,
      'Use specific HTTP method handlers (app.get, app.post) instead of app.all().',
    )
  },
}
