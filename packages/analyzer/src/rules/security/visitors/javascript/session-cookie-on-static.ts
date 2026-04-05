import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const sessionCookieOnStaticVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/session-cookie-on-static',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    let objectName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      const obj = fn.childForFieldName('object')
      if (prop) methodName = prop.text
      if (obj) objectName = obj.text
    }

    // app.use('/static', session(...), express.static(...))
    // Detect app.use(path, session, static) pattern
    if (methodName !== 'use') return null

    const args = node.childForFieldName('arguments')
    if (!args || args.namedChildren.length < 2) return null

    const firstArg = args.namedChildren[0]
    // First arg should be a static-like path
    if (firstArg?.type !== 'string') return null
    const routePath = firstArg.text.replace(/['"]/g, '').toLowerCase()
    if (!routePath.includes('static') && !routePath.includes('assets') &&
        !routePath.includes('public') && !routePath.includes('css') &&
        !routePath.includes('js') && !routePath.includes('images')) return null

    // Check if session middleware is also in the args
    const middlewareText = args.namedChildren.slice(1).map((n) => n.text).join(' ')
    if (middlewareText.includes('session(') || middlewareText.includes('cookieSession(')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Session middleware on static routes',
        `Session middleware applied to static route "${routePath}". This creates unnecessary session overhead.`,
        sourceCode,
        'Remove session middleware from static file routes.',
      )
    }

    return null
  },
}
