import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonSslNoVersionVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/ssl-no-version',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    let objectName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      const obj = fn.childForFieldName('object')
      if (attr) funcName = attr.text
      if (obj) objectName = obj.text
    }

    if (objectName !== 'ssl' || funcName !== 'SSLContext') return null

    const args = node.childForFieldName('arguments')
    // SSLContext with no arguments or only PROTOCOL_TLS (deprecated)
    if (!args || args.namedChildren.length === 0) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'SSL context without protocol version',
        'ssl.SSLContext() called without specifying a protocol version. This may use insecure defaults.',
        sourceCode,
        'Use ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT) or ssl.create_default_context() for secure TLS.',
      )
    }

    const firstArg = args.namedChildren[0]
    if (firstArg && (firstArg.text.includes('PROTOCOL_TLS') && !firstArg.text.includes('PROTOCOL_TLS_CLIENT') &&
        !firstArg.text.includes('PROTOCOL_TLS_SERVER'))) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'SSL context without protocol version',
        `ssl.SSLContext(${firstArg.text}) uses a deprecated protocol selector. Specify minimum version explicitly.`,
        sourceCode,
        'Use ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT) and set ctx.minimum_version.',
      )
    }

    return null
  },
}
