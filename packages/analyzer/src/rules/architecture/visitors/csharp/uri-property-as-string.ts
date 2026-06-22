import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'
import { isStringType, nameLooksLikeUri } from './_uri-helpers.js'

/**
 * A property whose name signals it holds a URI (…Url, …Uri, …Endpoint) but is
 * typed `string` loses the parsing and validation `System.Uri` provides. Only
 * public-surface properties are flagged.
 */
export const csharpUriPropertyAsStringVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/uri-property-as-string',
  languages: ['csharp'],
  nodeTypes: ['property_declaration'],
  visit(node, filePath, sourceCode) {
    if (!hasCSharpModifier(node, 'public')) return null
    if (!isStringType(node.childForFieldName('type'))) return null
    const name = node.childForFieldName('name')?.text
    if (!name || !nameLooksLikeUri(name)) return null

    return makeViolation(
      this.ruleKey, node.childForFieldName('type')!, filePath, 'low',
      'URI property typed as string',
      `Property '${name}' holds a URI but is typed as string; use System.Uri to get parsing and validation.`,
      sourceCode,
      `Change the type of '${name}' from string to System.Uri.`,
    )
  },
}
