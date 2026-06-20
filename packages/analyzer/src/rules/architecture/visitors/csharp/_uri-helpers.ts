import type { Node as SyntaxNode } from 'web-tree-sitter'

/**
 * Names that strongly signal the value is a URL/URI. Conservative on purpose:
 * generic words like "address" or "path" are excluded because they routinely
 * hold non-URI data (street address, file path), which would produce false
 * positives. Matched case-insensitively as a whole-word suffix/prefix.
 */
const URI_NAME_PATTERN = /(^|[^a-z])(url|uri|uris|urls|endpoint|endpoints|webhook|webhookurl|callbackurl|redirecturi|redirecturl|hreflink|baseurl|baseaddress)$/i

export function nameLooksLikeUri(name: string): boolean {
  if (URI_NAME_PATTERN.test(name)) return true
  // PascalCase composite ending in Url/Uri/Endpoint (CallbackUrl, ImageUri…).
  return /(Url|Uri|Endpoint|Webhook)$/.test(name)
}

/** True when a type node is exactly the `string` predefined type. */
export function isStringType(typeNode: SyntaxNode | null): boolean {
  return typeNode?.type === 'predefined_type' && typeNode.text === 'string'
}
