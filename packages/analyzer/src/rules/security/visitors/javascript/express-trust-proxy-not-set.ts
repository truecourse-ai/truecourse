import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const expressTrustProxyNotSetVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/express-trust-proxy-not-set',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Look for app.set('trust proxy', ...) calls
    let methodName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) methodName = prop.text
    }

    if (methodName !== 'set') return null

    const args = node.childForFieldName('arguments')
    if (!args || args.namedChildren.length < 2) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const settingName = firstArg.text.replace(/['"]/g, '').toLowerCase()
    if (settingName !== 'trust proxy') return null

    const valueArg = args.namedChildren[1]
    if (!valueArg) return null

    // Flag if trust proxy is set to false or 0
    if (valueArg.text === 'false' || valueArg.text === '0') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Express trust proxy not configured',
        'app.set("trust proxy", false) disables proxy trust. If this app is behind a reverse proxy, IP detection will be incorrect.',
        sourceCode,
        'Set trust proxy to the number of proxies or a specific IP: app.set("trust proxy", 1).',
      )
    }

    return null
  },
}
