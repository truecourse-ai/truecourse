import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from './_helpers.js'

// Canonical third-party / spec-defined domains — fixed by definition, not env-configurable
const CANONICAL_THIRD_PARTY = /(?:^|[/@])(?:googleapis\.com|maps\.google|api\.stripe\.com|dashboard\.stripe\.com|api\.twilio\.com|api\.sendgrid\.com|api\.github\.com|github\.com|raw\.githubusercontent\.com|gist\.github\.com|cdn\.|fonts\.googleapis|fonts\.gstatic\.com|cloudflare|unpkg\.com|cdnjs\.cloudflare|jsdelivr\.net|accounts\.google\.com|login\.microsoftonline\.com|appleid\.apple\.com|github\.com\/login|gitlab\.com|bitbucket\.org|chatgpt\.com|claude\.ai|gemini\.google\.com|openai\.com|anthropic\.com|twitter\.com|x\.com|facebook\.com|linkedin\.com|youtube\.com|api\.postmarkapp\.com|postmarkapp\.com|mailchannels\.net|api\.mailchannels\.net|api\.sendgrid\.net|sendgrid\.com|api\.mailgun\.net|mailgun\.com|api\.resend\.com|api\.brevo\.com|hooks\.slack\.com|api\.slack\.com|api\.notion\.com|api\.linear\.app|api\.openai\.com|api\.anthropic\.com)/

// Property/variable names that strongly indicate non-runtime URL (docs, config, display, deprecation)
const NON_RUNTIME_PROP_NAMES = /^(?:metadatabase|host|sitemap|canonical|baseurl|base_url|public_url|repourl|repo_url|repository|repositoryurl|homepage|website|docs|docsurl|documentation|description|summary|deprecated|deprecation|message|placeholder|example|hint|tooltip|helptext|label|title|comment|note|notice|info|usage|readme|changelog|license|aboutus|about|contact|support|terms|privacy|legal|blog|blogurl|sociallink|socialurl|twitterurl|githuburl|linkedinurl|websiteurl|companyurl|brandurl|marketingurl|landingurl)$/

// Filenames where canonical site URLs are required (Next.js SEO, robots, sitemap)
const SEO_CONFIG_FILE = /\/(?:sitemap|robots|manifest)\.(?:ts|tsx|js|jsx|mjs|cjs)$/

// Component / function name patterns indicating email-template / preview / storybook
const EMAIL_PREVIEW_NAME = /(?:Email|Template|Preview|Story|Storybook|Mailer|Notification)$/

const EMAIL_TEMPLATE_FILE = /\/(?:email|emails|templates|mailers?|notifications?)\//i

function getCallExpression(argsNode: SyntaxNode | null): SyntaxNode | null {
  if (!argsNode || argsNode.type !== 'arguments') return null
  return argsNode.parent?.type === 'call_expression' ? argsNode.parent : null
}

function getCalleeMember(callExpr: SyntaxNode): { object?: string; property?: string } {
  const callee = callExpr.childForFieldName('function')
  if (callee?.type === 'member_expression') {
    const obj = callee.childForFieldName('object')
    const prop = callee.childForFieldName('property')
    return { object: obj?.text, property: prop?.text }
  }
  if (callee?.type === 'identifier') {
    return { property: callee.text }
  }
  return {}
}

// Walk up to find enclosing function/component declaration for name-based heuristics
function getEnclosingFunctionName(node: SyntaxNode): string | null {
  let cur: SyntaxNode | null = node.parent
  while (cur) {
    if (cur.type === 'function_declaration' || cur.type === 'function_expression' || cur.type === 'method_definition') {
      const nameNode = cur.childForFieldName('name')
      if (nameNode?.text) return nameNode.text
    }
    if (cur.type === 'variable_declarator') {
      const valueNode = cur.childForFieldName('value')
      if (valueNode && (valueNode.type === 'arrow_function' || valueNode.type === 'function_expression')) {
        const nameNode = cur.childForFieldName('name')
        if (nameNode?.text) return nameNode.text
      }
    }
    cur = cur.parent
  }
  return null
}

// Is node inside a function default parameter (formal_parameters/required_parameter/optional_parameter with `= value`)?
function isDefaultParameterValue(node: SyntaxNode): boolean {
  let cur: SyntaxNode | null = node.parent
  while (cur) {
    if (cur.type === 'assignment_pattern') {
      // assignment_pattern lives inside formal_parameters / object_pattern
      let p: SyntaxNode | null = cur.parent
      while (p) {
        if (p.type === 'formal_parameters') return true
        if (p.type === 'object_pattern' || p.type === 'pair_pattern' || p.type === 'object_assignment_pattern') {
          // Continue up — destructured params have the default inside an object_pattern under formal_parameters
          p = p.parent
          continue
        }
        if (p.type === 'arguments' || p.type === 'function_declaration' || p.type === 'arrow_function' || p.type === 'method_definition' || p.type === 'function_expression') return p.type !== 'arguments'
        p = p.parent
      }
    }
    // Stop walking once we exit the immediate value context
    if (cur.type === 'function_declaration' || cur.type === 'arrow_function' || cur.type === 'function_expression' || cur.type === 'method_definition') break
    cur = cur.parent
  }
  return false
}

// Is node the fallback of `env(...) ?? 'url'` / `env(...) || 'url'`?
function isFallbackOfNullishOr(node: SyntaxNode): boolean {
  const parent = node.parent
  if (!parent || parent.type !== 'binary_expression') return false
  const op = parent.childForFieldName('operator')?.text ?? ''
  if (op !== '??' && op !== '||') return false
  // node must be the right-hand side
  const right = parent.childForFieldName('right')
  return right?.id === node.id
}

// Is node inside an argument list passed to console.* or a log-like function?
function isInsideLoggingCall(node: SyntaxNode): boolean {
  let cur: SyntaxNode | null = node.parent
  while (cur) {
    if (cur.type === 'arguments') {
      const callExpr = getCallExpression(cur)
      if (callExpr) {
        const { object, property } = getCalleeMember(callExpr)
        if (object === 'console') return true
        if (property && /^(?:log|warn|info|error|debug|trace|notice|print|println|write|writeln)$/i.test(property)) return true
      }
    }
    if (cur.type === 'statement_block' || cur.type === 'program') break
    cur = cur.parent
  }
  return false
}

// Get the property/variable name that a string literal is being assigned to (variable_declarator name,
// assignment_expression left, pair key, public_field_definition name).
function getAssignedName(node: SyntaxNode): string | null {
  const parent = node.parent
  if (!parent) return null
  if (parent.type === 'variable_declarator' || parent.type === 'assignment_expression') {
    const n = parent.childForFieldName('name') ?? parent.childForFieldName('left')
    return n?.text ?? null
  }
  if (parent.type === 'pair') {
    const key = parent.childForFieldName('key')
    // Property key can be identifier or property_identifier or string
    if (!key) return null
    if (key.type === 'string') return key.text.slice(1, -1)
    return key.text
  }
  if (parent.type === 'public_field_definition' || parent.type === 'field_definition' || parent.type === 'property_definition') {
    const n = parent.childForFieldName('name')
    return n?.text ?? null
  }
  // Default-param case: assignment_pattern's left is the param name
  if (parent.type === 'assignment_pattern') {
    const left = parent.childForFieldName('left')
    return left?.text ?? null
  }
  return null
}

// Walk up to find a binding name that this string contributes to, even through wrappers like `new URL(...)`.
function getEnclosingBindingName(node: SyntaxNode): string | null {
  let cur: SyntaxNode | null = node
  let depth = 0
  while (cur && depth < 6) {
    const direct = getAssignedName(cur)
    if (direct) return direct
    const p = cur.parent
    if (!p) break
    // Step through wrappers: arguments → call/new_expression → variable_declarator/assignment
    if (p.type === 'arguments' || p.type === 'call_expression' || p.type === 'new_expression' || p.type === 'parenthesized_expression') {
      cur = p
      depth++
      continue
    }
    break
  }
  return null
}

// Is node inside .default(...) — Zod schema or similar
function isInsideDefaultCall(node: SyntaxNode): boolean {
  const parent = node.parent
  if (parent?.type !== 'arguments') return false
  const callExpr = getCallExpression(parent)
  if (!callExpr) return false
  const callee = callExpr.childForFieldName('function')
  if (callee?.type !== 'member_expression') return false
  const prop = callee.childForFieldName('property')
  return prop?.text === 'default'
}

// Is the parent JSX-ish (attribute / text / expression container under JSX element)?
function isJsxContext(node: SyntaxNode): boolean {
  let cur: SyntaxNode | null = node.parent
  let depth = 0
  while (cur && depth < 4) {
    if (cur.type === 'jsx_attribute' || cur.type === 'jsx_expression' || cur.type === 'jsx_text') return true
    if (cur.type === 'jsx_element' || cur.type === 'jsx_self_closing_element' || cur.type === 'jsx_opening_element') return true
    if (cur.type === 'jsx_expression_container') return true
    cur = cur.parent
    depth++
  }
  return false
}

// Extract first URL host from text (returns lower-cased host or null)
function extractFirstUrlHost(text: string): string | null {
  const m = text.match(/https?:\/\/([a-zA-Z0-9][\w.-]*)/)
  return m ? m[1].toLowerCase() : null
}

// For template_string: split content into static parts (excluding substitutions) and check
// whether substitutions exist (meaning at least path segment is dynamic).
function templateHasSubstitution(node: SyntaxNode): boolean {
  if (node.type !== 'template_string') return false
  return node.namedChildren.some((c) => c.type === 'template_substitution')
}

// Check if string node is inside a JSX attribute (covers parent and grandparent through
// jsx_expression_container).
function isInsideJsxAttribute(node: SyntaxNode): boolean {
  let cur: SyntaxNode | null = node.parent
  let depth = 0
  while (cur && depth < 4) {
    if (cur.type === 'jsx_attribute') return true
    if (cur.type !== 'jsx_expression_container' && cur.type !== 'parenthesized_expression') return false
    cur = cur.parent
    depth++
  }
  return false
}

export const hardcodedUrlVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/hardcoded-url',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['string', 'template_string'],
  visit(node, filePath, sourceCode) {
    const text = node.text

    // Must look like a real http(s) URL with a non-trivial host
    if (!/https?:\/\/[a-zA-Z0-9]/.test(text)) return null

    // Skip common stub/placeholder/standard markers
    if (text.includes('example.com') || text.includes('localhost') || text.includes('placeholder')) return null
    if (/w3\.org|schema\.org|xmlns|openxmlformats|xmlsoap|purl\.org/.test(text)) return null

    // Skip canonical third-party / spec-defined domains
    if (CANONICAL_THIRD_PARTY.test(text)) return null
    const host = extractFirstUrlHost(text)
    if (host && CANONICAL_THIRD_PARTY.test('/' + host)) return null

    // Skip spec-defined well-known endpoints (OIDC discovery, Webfinger, etc.) — path is the contract
    if (/\/\.well-known\/(?:openid-configuration|jwks\.json|webfinger|host-meta|change-password|security\.txt|nodeinfo|oauth-authorization-server)/.test(text)) return null

    // Skip URLs in any JSX attribute (href, src, action, placeholder, data-*, etc.)
    if (isInsideJsxAttribute(node)) return null

    // Skip URLs inside .default(...) calls (Zod schema defaults, etc.)
    if (isInsideDefaultCall(node)) return null

    // Skip URLs inside console.* or logging-like calls (informational text, not endpoints)
    if (isInsideLoggingCall(node)) return null

    // Skip URLs in function default parameter values (template-component defaults overwritten by callers)
    if (isDefaultParameterValue(node)) {
      // Strong signal: usually safe. Allow only if enclosing function name doesn't look like a service entrypoint.
      return null
    }

    // Skip URLs as the fallback of env() ?? '...' or env() || '...'
    if (isFallbackOfNullishOr(node)) return null

    // Skip URLs assigned to vars / props whose name indicates documentation, display, default,
    // canonical site config, or other non-runtime use.
    const assignedName = getEnclosingBindingName(node)
    const lowerName = assignedName?.toLowerCase() ?? ''
    if (lowerName) {
      if (NON_RUNTIME_PROP_NAMES.test(lowerName)) return null
      if (/default|placeholder|example|sample|template|fallback|demo|mock|stub|dummy|hint|notice|deprecated|description|message|label|tooltip|comment|note|readme|docs?|sitemap|robots|repo|homepage|website|social/i.test(lowerName)) return null
    }

    // Skip URLs that are pair-property values where the key is a display-attribute name
    // (href/src/link/url in navlink-style object literals — these are user-navigation targets, not
    // service endpoints). Limit to pair-context to avoid suppressing plain variable assignments.
    {
      const parent = node.parent
      if (parent?.type === 'pair') {
        const key = parent.childForFieldName('key')
        const keyName = (key?.type === 'string' ? key.text.slice(1, -1) : key?.text ?? '').toLowerCase()
        if (/^(?:href|src|url|link|action|to|page|target|redirecturl|redirect_url|callbackurl|callback_url|returnurl|return_url|loginurl|logouturl|signinurl|signupurl)$/.test(keyName)) return null
      }
    }

    // Skip URLs in files matching SEO/site-config patterns (sitemap.ts, robots.ts, manifest.ts)
    if (SEO_CONFIG_FILE.test(filePath)) return null

    // Skip URLs in email/template/preview files (default-prop URLs are caller-injected at runtime)
    if (EMAIL_TEMPLATE_FILE.test(filePath)) {
      const fnName = getEnclosingFunctionName(node)
      if (fnName && EMAIL_PREVIEW_NAME.test(fnName)) return null
      // Also suppress if assigned to a name suggesting a preview/default URL
      if (lowerName && /url|link|href/.test(lowerName) && isDefaultParameterValue(node.parent ?? node)) return null
    }

    // Template literal with at least one substitution where origin is a canonical/known marketing domain
    // and the dynamic part forms the path — already handled by CANONICAL_THIRD_PARTY above.

    // Skip template literals where the URL is fully canonical-domain + dynamic path
    if (node.type === 'template_string' && templateHasSubstitution(node)) {
      // Only suppress if entirety after origin is dynamic; otherwise emit
      const staticHeadMatch = text.match(/^`(https?:\/\/[^`$]+)/)
      if (staticHeadMatch) {
        const staticHead = staticHeadMatch[1]
        const headHost = extractFirstUrlHost(staticHead)
        if (headHost && CANONICAL_THIRD_PARTY.test('/' + headHost)) return null
        // If static head ends right after host (no fixed path beyond '/'), treat as dynamic-path template
        const afterHost = staticHead.replace(/^https?:\/\/[a-zA-Z0-9][\w.-]*/, '')
        if (afterHost === '' || afterHost === '/' || afterHost === '/?') {
          // Domain-only static head with dynamic path — generally safe (caller chooses path)
          return null
        }
      }
    }

    // Skip URLs inside string concatenation where one operand is an env/config call
    {
      const parent = node.parent
      if (parent?.type === 'binary_expression') {
        const left = parent.childForFieldName('left')
        const right = parent.childForFieldName('right')
        const other = left?.id === node.id ? right : left
        if (other?.type === 'call_expression') {
          const fnName = other.childForFieldName('function')?.text ?? ''
          if (/env|config|process|getEnv|readEnv/i.test(fnName)) return null
        }
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Hardcoded URL',
      `URL \`${text.slice(0, 60)}\` is hardcoded in source. Move it to configuration or environment variables.`,
      sourceCode,
      'Extract the URL to a config constant or environment variable.',
    )
  },
}
