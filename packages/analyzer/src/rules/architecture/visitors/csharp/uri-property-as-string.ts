import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributeNames, getCSharpStringText, hasCSharpModifier, isCSharpStringNode } from '../../../_shared/csharp-helpers.js'
import { isStringType, nameLooksLikeUri } from './_uri-helpers.js'

// Attributes that bind the property from an inbound request. A model-bound
// value is frequently a relative path (a `ReturnUrl`, a route segment) that
// must stay a string for the binder to populate it — retyping to System.Uri
// breaks binding — so the rule must not fire on bound properties.
const BINDING_ATTRIBUTES = new Set(['BindProperty', 'FromQuery', 'FromRoute', 'FromForm', 'ModelBinder'])

/**
 * A concrete string-literal initializer proves what the property actually holds.
 * A value with a scheme (`https://…`) is a real absolute URI — keep flagging it.
 * A non-empty literal with no scheme is a bare host (`sms.example.com`) or a
 * relative path (`/account/login`), neither of which is a `System.Uri`, so the
 * property is legitimately a string. An empty/`string.Empty`/non-literal
 * initializer tells us nothing, so it stays flaggable.
 */
function initializerProvesNotUri(valueNode: SyntaxNode | null): boolean {
  if (!valueNode || !isCSharpStringNode(valueNode)) return false
  const text = getCSharpStringText(valueNode)
  if (text == null || text.length === 0) return false
  return !text.includes('://')
}

/**
 * A property whose name signals it holds a URI (…Url, …Uri, …Endpoint) but is
 * typed `string` loses the parsing and validation `System.Uri` provides. Only
 * public-surface properties are flagged. Model-bound properties and ones whose
 * literal value is a bare host / relative path are exempt — those are genuinely
 * strings, not absolute URIs.
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
    // Request-bound properties are populated by the model binder from strings
    // (often relative), where System.Uri would break binding.
    if (getCSharpAttributeNames(node).some((a) => BINDING_ATTRIBUTES.has(a))) return null
    // A concrete non-URI literal value proves the property isn't an absolute URI.
    if (initializerProvesNotUri(node.childForFieldName('value'))) return null

    return makeViolation(
      this.ruleKey, node.childForFieldName('type')!, filePath, 'low',
      'URI property typed as string',
      `Property '${name}' holds a URI but is typed as string; use System.Uri to get parsing and validation.`,
      sourceCode,
      `Change the type of '${name}' from string to System.Uri.`,
    )
  },
}
