import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// XML/SOAP/schema namespace hosts — fixed identifiers, not service endpoints.
// `tempuri.org` and `schemas.microsoft.com` are the .NET-specific additions.
const NAMESPACE_URI_HOSTS = /w3\.org|schema\.org|xmlns|openxmlformats|xmlsoap|purl\.org|tempuri\.org|schemas\.microsoft\.com|tools\.ietf\.org|datatracker\.ietf\.org|rfc-editor\.org/

// Stable third-party API/CDN domains with no environment-specific form.
const STABLE_API_HOSTS = /googleapis\.com|maps\.google|api\.stripe\.com|api\.twilio\.com|api\.sendgrid\.com|api\.github\.com|cdn\.|fonts\.googleapis|cloudflare|unpkg\.com|cdnjs\.cloudflare|jsdelivr\.net|nuget\.org/

const PLACEHOLDER_NAME = /default|placeholder|example|sample|template|fallback|demo|test|mock|stub|dummy/

/** The name the URL is being assigned to, walking up declarator/assignment/property shapes. */
function assignedName(node: SyntaxNode): string {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'variable_declarator') return current.childForFieldName('name')?.text ?? ''
    if (current.type === 'assignment_expression') return current.childForFieldName('left')?.text ?? ''
    if (current.type === 'property_declaration') return current.childForFieldName('name')?.text ?? ''
    if (current.type === 'parameter') return current.childForFieldName('name')?.text ?? ''
    if (current.type === 'block' || current.type === 'declaration_list'
      || current.type === 'argument_list' || current.type === 'attribute_argument_list') return ''
    current = current.parent
  }
  return ''
}

function isInsideAttribute(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'attribute') return true
    if (current.type === 'block' || current.type === 'declaration_list') return false
    current = current.parent
  }
  return false
}

export const csharpHardcodedUrlVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/hardcoded-url',
  languages: ['csharp'],
  nodeTypes: ['string_literal', 'verbatim_string_literal', 'raw_string_literal', 'interpolated_string_expression'],
  visit(node, filePath, sourceCode) {
    const text = node.text

    if (!/https?:\/\/[a-zA-Z0-9]/.test(text)) return null
    if (text.includes('example.com') || text.includes('localhost')
      || text.includes('127.0.0.1') || text.includes('placeholder')) return null
    if (NAMESPACE_URI_HOSTS.test(text)) return null
    if (STABLE_API_HOSTS.test(text)) return null
    // OIDC/OAuth discovery endpoints are owned by the identity provider.
    if (/\.well-known\/(openid-configuration|oauth-authorization-server|jwks(?:\.json)?)/.test(text)) return null
    // URLs in attribute arguments are WCF/XML contract namespaces or
    // documentation links, not environment-specific endpoints.
    if (isInsideAttribute(node)) return null

    const name = assignedName(node).toLowerCase()
    if (name && PLACEHOLDER_NAME.test(name)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Hardcoded URL',
      `URL \`${text.slice(0, 60)}\` is hardcoded in source. Move it to configuration (appsettings.json, environment variable, or IOptions).`,
      sourceCode,
      'Extract the URL to configuration and read it via IConfiguration/IOptions.',
    )
  },
}
