import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { getCSharpReceiverSimpleName } from './_helpers.js'

/**
 * `BitConverter.ToString(bytes).Replace("-", "")...` hex-encodes a byte array
 * by formatting with dashes and then stripping them — three allocations and a
 * full rescan. `Convert.ToHexString(bytes)` produces the hex string directly.
 * Anchored on the `BitConverter.ToString(...).Replace("-", ...)` core so the
 * trailing `.ToLower()` (if any) does not change detection.
 */
export const csharpUseToHexStringVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/use-tohexstring',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'Replace') return null

    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null
    const inner = fn.childForFieldName('expression')
    if (inner?.type !== 'invocation_expression') return null
    if (getCSharpMethodName(inner) !== 'ToString') return null
    if (getCSharpReceiverSimpleName(inner) !== 'BitConverter') return null

    // First Replace argument must be the "-" separator BitConverter inserts.
    const replaceArgs = getCSharpArguments(node)
    const firstArg = replaceArgs[0]
    if (!firstArg || firstArg.text !== '"-"') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Use Convert.ToHexString',
      'Hex-encoding bytes via BitConverter.ToString(...).Replace("-", "") formats with dashes and then strips them, allocating several intermediate strings. Convert.ToHexString produces the hex string directly.',
      sourceCode,
      'Replace the BitConverter.ToString(...).Replace(...) chain with Convert.ToHexString(bytes).',
    )
  },
}
