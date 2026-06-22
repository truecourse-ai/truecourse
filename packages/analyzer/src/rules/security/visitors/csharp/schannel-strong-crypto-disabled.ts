import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { getCallArgs, isPlainStringLiteral, staticStringText } from './_helpers.js'

/**
 * `AppContext.SetSwitch("Switch.System.Net.DontEnableSchUseStrongCrypto", true)`
 * — turning ON the "don't enable strong crypto" switch weakens the algorithms
 * Schannel negotiates for outgoing TLS connections.
 */
const SWITCH_NAME = 'Switch.System.Net.DontEnableSchUseStrongCrypto'

export const csharpSchannelStrongCryptoDisabledVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/schannel-strong-crypto-disabled',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'SetSwitch') return null
    const args = getCallArgs(node)
    const nameArg = args[0]?.value
    const valueArg = args[1]?.value
    if (!nameArg || !isPlainStringLiteral(nameArg) || staticStringText(nameArg) !== SWITCH_NAME) return null
    if (valueArg?.type !== 'boolean_literal' || valueArg.text !== 'true') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Schannel strong crypto disabled',
      'Setting DontEnableSchUseStrongCrypto to true weakens the cryptography Schannel negotiates for outgoing TLS connections.',
      sourceCode,
      'Remove this switch (or set it to false) so strong cryptography stays enabled.',
    )
  },
}
