import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { getCallArgs, isPlainStringLiteral, staticStringText } from './_helpers.js'

/**
 * `AppContext.SetSwitch("Switch.System.ServiceModel.DisableUsingServicePointManagerSecurityProtocols", true)`
 * — enabling this switch pins WCF's TLS negotiation to the deprecated TLS 1.0
 * instead of honoring ServicePointManager's protocol selection.
 */
const SWITCH_NAME = 'Switch.System.ServiceModel.DisableUsingServicePointManagerSecurityProtocols'

export const csharpServicePointManagerProtocolsDisabledVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/servicepointmanager-protocols-disabled',
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
      'ServicePointManager security protocols disabled',
      'Enabling DisableUsingServicePointManagerSecurityProtocols pins WCF TLS to the deprecated TLS 1.0.',
      sourceCode,
      'Remove this switch so WCF honors the configured (modern) security protocols.',
    )
  },
}
