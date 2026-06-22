import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'
import { isStringType, nameLooksLikeUri } from './_uri-helpers.js'

/**
 * A public method whose name signals it produces a URI (GetCallbackUrl,
 * BuildEndpoint, …) but returns `string` loses the validation `System.Uri`
 * gives callers. Flagged on public methods only.
 */
export const csharpUriReturnAsStringVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/uri-return-as-string',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    if (!hasCSharpModifier(node, 'public')) return null
    if (!isStringType(node.childForFieldName('returns'))) return null
    const name = node.childForFieldName('name')?.text
    if (!name || !nameLooksLikeUri(name)) return null

    return makeViolation(
      this.ruleKey, node.childForFieldName('returns')!, filePath, 'low',
      'URI return value typed as string',
      `Method '${name}' returns a URI as string; return System.Uri so callers get a validated value.`,
      sourceCode,
      `Change the return type of '${name}' from string to System.Uri.`,
    )
  },
}
