import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInsideAsyncFunctionOrHandler } from './_helpers.js'

const SYNC_CRYPTO_METHODS = new Set(['pbkdf2Sync', 'scryptSync', 'randomFillSync', 'generateKeyPairSync'])

export const synchronousCryptoVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/synchronous-crypto',
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

    if (!SYNC_CRYPTO_METHODS.has(methodName)) return null

    if (!isInsideAsyncFunctionOrHandler(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Synchronous crypto operation in async context',
      `${methodName}() blocks the event loop. Use the async version in request handlers.`,
      sourceCode,
      `Replace ${methodName}() with its async counterpart (e.g., crypto.pbkdf2() with callback or util.promisify).`,
    )
  },
}
