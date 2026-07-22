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

const TYPE_DECL_TYPES = new Set([
  'class_declaration', 'record_declaration', 'struct_declaration', 'record_struct_declaration',
])

/** The simple (unqualified) name of a base-type entry node. */
function baseTypeSimpleName(node: SyntaxNode): string | null {
  switch (node.type) {
    case 'identifier':
      return node.text
    case 'qualified_name':
      // `A.B.Base` → the trailing segment.
      return node.childForFieldName('name')?.text ?? node.lastNamedChild?.text ?? null
    case 'generic_name':
      // `Base<T>` → `Base`.
      return node.namedChildren.find((c) => c?.type === 'identifier')?.text ?? null
    default:
      return null
  }
}

/**
 * The simple names of the types the property's enclosing type derives from
 * (base class + implemented interfaces), or an empty array when it derives from
 * nothing. Walks up to the nearest type declaration and reads its `base_list`.
 */
export function enclosingTypeBaseNames(node: SyntaxNode): string[] {
  let current: SyntaxNode | null = node.parent
  while (current && !TYPE_DECL_TYPES.has(current.type)) current = current.parent
  if (!current) return []
  const baseList = current.namedChildren.find((c) => c?.type === 'base_list')
  if (!baseList) return []
  const names: string[] = []
  for (const entry of baseList.namedChildren) {
    if (!entry) continue
    const name = baseTypeSimpleName(entry)
    if (name) names.push(name)
  }
  return names
}

// Framework base types whose URI-named string properties are the framework's
// contract, not an absolute System.Uri: persistence index rows map a property to
// a database column (must stay string), and CMS content-model fields hold
// user-entered links that are routinely relative (`~/…`), anchors (`#…`) or
// `mailto:` — all invalid as an absolute Uri.
const CONTENT_MODEL_BASES = new Set(['ContentField', 'ContentPart', 'ContentElement', 'FieldSettings'])

/**
 * True when the property's declaring type derives from a persistence-index base
 * (a simple name ending in `Index`, e.g. `MapIndex`/`ReduceIndex`) or a
 * content-model base. Properties there hold a DB-column string or user-entered
 * (often relative) link, so `uri-property-as-string` must not fire.
 */
export function declaringTypeIsFrameworkModel(node: SyntaxNode): boolean {
  return enclosingTypeBaseNames(node).some(
    (base) => base.endsWith('Index') || CONTENT_MODEL_BASES.has(base),
  )
}
