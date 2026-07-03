import type { Node as SyntaxNode } from 'web-tree-sitter'

/**
 * Names that strongly signal the value is a URL/URI. Conservative on purpose:
 * generic words like "address" or "path" are excluded because they routinely
 * hold non-URI data (street address, file path), which would produce false
 * positives. Matched case-insensitively as a whole-word suffix/prefix.
 */
const URI_NAME_PATTERN = /(^|[^a-z])(url|uri|uris|urls|endpoint|endpoints|webhook|webhookurl|callbackurl|redirecturi|redirecturl|hreflink|baseurl|baseaddress)$/i

// A URI token preceded by a preposition (`…InUrl`, `…AsUri`, `…OfEndpoint`)
// describes the *context* a value appears in, not a URI value — e.g.
// `ActionNameInUrl` holds an action-name segment that merely travels in the URL.
// The genuine URI names this rule targets read as "the X URL" (`CallbackUrl`,
// `BaseUrl`), where the preceding token names which URL, not a preposition.
const PREPOSITION_BEFORE_URI = /(In|As|Of|At|By|Within)(Url|Uri|Uris|Urls|Endpoint|Endpoints|Webhook)$/

export function nameLooksLikeUri(name: string): boolean {
  if (PREPOSITION_BEFORE_URI.test(name)) return false
  if (URI_NAME_PATTERN.test(name)) return true
  // PascalCase composite ending in Url/Uri/Endpoint (CallbackUrl, ImageUri…).
  return /(Url|Uri|Endpoint|Webhook)$/.test(name)
}

/** True when a type node is exactly the `string` predefined type. */
export function isStringType(typeNode: SyntaxNode | null): boolean {
  return typeNode?.type === 'predefined_type' && typeNode.text === 'string'
}
