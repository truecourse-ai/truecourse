import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Framework canonical-URL config keys. Values assigned to these keys are
// the SITE'S OWN canonical URL — configuration metadata, not service
// endpoints. Hard-coding the site URL is normal in:
//   Next.js: `metadataBase`, `siteUrl`, `canonical`, `host`, `sitemap`
//   Remix:   `siteUrl`, `canonical`
//   robots.ts / sitemap.ts: `host`, `sitemap`
const FRAMEWORK_URL_CONFIG_KEYS = new Set<string>([
  // Next.js metadata + robots.ts + sitemap.ts conventions
  'metadatabase', 'siteurl', 'canonical', 'host', 'sitemap',
  // Canonical site URL config (NOT api/service endpoints — those are TPs)
  'baseurl', 'homepageurl', 'publicurl',
  // OIDC discovery (the URL is a published spec endpoint, not a service we
  // own; hard-coded by definition).
  'wellknownurl',
  // Email-template default-link conventions: optional `link` parameter
  // defaults that point at the site's own canonical address as a fallback.
  'documentlink', 'downloadlink', 'signdocumentlink', 'resetpasswordlink',
  'unsubscribelink',
])

// Variable names whose value is conventionally the canonical site URL.
// SCREAMING_SNAKE constants like `BASE_URL`, `SITE_URL`, `CANONICAL_URL`,
// `HOST_URL`, `PUBLIC_URL`, `APP_URL`.
function isCanonicalUrlConstantName(name: string): boolean {
  return /^(?:BASE|SITE|CANONICAL|HOST|PUBLIC|APP|FRONTEND|BACKEND|API|HOMEPAGE)_?URL$/.test(name)
}

// Walk up the AST looking for an enclosing `pair` (object-literal property)
// or `variable_declarator`. Returns the property/variable name if found.
// Skips intermediate `arguments` / `new_expression` / `parenthesized_expression`
// nodes so `metadataBase: new URL('https://...')` resolves to `metadataBase`.
function findEnclosingAssignmentName(node: SyntaxNode): string | null {
  let current: SyntaxNode | null = node.parent
  let depth = 0
  while (current && depth < 6) {
    if (current.type === 'pair') {
      return current.childForFieldName('key')?.text ?? null
    }
    if (current.type === 'variable_declarator' || current.type === 'assignment_expression') {
      return current.childForFieldName('name')?.text ?? null
    }
    // Destructured default param: `function f({ baseUrl = 'https://…' })`.
    // The pattern's left child holds the key name.
    if (current.type === 'object_assignment_pattern' || current.type === 'assignment_pattern') {
      return current.childForFieldName('left')?.text ?? null
    }
    // Pass through transparent wrappers
    if (
      current.type === 'arguments' ||
      current.type === 'new_expression' ||
      current.type === 'call_expression' ||
      current.type === 'parenthesized_expression' ||
      current.type === 'as_expression' ||
      current.type === 'satisfies_expression' ||
      current.type === 'type_assertion'
    ) {
      current = current.parent
      depth++
      continue
    }
    break
  }
  return null
}

export const hardcodedUrlVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/hardcoded-url',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['string', 'template_string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    // Skip well-known namespace/standard URIs (SVG xmlns, schema.org, W3C, etc.)
    if (/w3\.org|schema\.org|xmlns|openxmlformats|xmlsoap|purl\.org/.test(text)) return null

    // Skip URLs inside ANY JSX attribute — URLs in JSX are typically display/config values
    // (src, href, placeholder, action, data-*, etc.) not hardcoded service endpoints
    const parent = node.parent
    if (parent?.type === 'jsx_attribute') return null

    // Skip URLs assigned to framework canonical-URL config keys (metadataBase,
    // host, sitemap, siteUrl, canonical) or to SCREAMING_SNAKE *_URL
    // constants. Those are the site's identity, not a service endpoint.
    const enclosingName = findEnclosingAssignmentName(node)
    if (enclosingName) {
      if (FRAMEWORK_URL_CONFIG_KEYS.has(enclosingName.toLowerCase())) return null
      if (isCanonicalUrlConstantName(enclosingName)) return null
    }

    // Skip URLs in variable assignments where variable name indicates a placeholder/config default
    if (parent?.type === 'variable_declarator' || parent?.type === 'assignment_expression' || parent?.type === 'pair') {
      const nameNode = parent.type === 'pair'
        ? parent.childForFieldName('key')
        : parent.childForFieldName('name')
      const varName = nameNode?.text?.toLowerCase() ?? ''
      if (/default|placeholder|example|sample|template/.test(varName)) return null
    }

    // Skip URLs inside .default() method calls (e.g., Zod schema defaults: z.string().default('http://...'))
    if (parent?.type === 'arguments') {
      const callExpr = parent.parent
      if (callExpr?.type === 'call_expression') {
        const callee = callExpr.childForFieldName('function')
        if (callee?.type === 'member_expression') {
          const prop = callee.childForFieldName('property')
          if (prop?.text === 'default') return null
        }
      }
    }

    // Skip well-known stable third-party API domains — these are fixed endpoints, not environment-specific
    if (/googleapis\.com|maps\.google|api\.stripe\.com|api\.twilio\.com|api\.sendgrid\.com|api\.github\.com|cdn\.|fonts\.googleapis|cloudflare|unpkg\.com|cdnjs\.cloudflare|jsdelivr\.net/.test(text)) return null

    // Skip third-party deep-link / dashboard / share / hosting
    // domains. These are fixed external services we link to or
    // call; hardcoding them is correct because the SaaS owns
    // the endpoint, not us.
    if (/dashboard\.stripe\.com|billing\.stripe\.com|connect\.stripe\.com/.test(text)) return null
    if (/(?:^|\W)(?:us|eu|app)\.(?:i\.)?posthog\.com|posthog\.com\/(?:capture|decide|engage|s\b)/.test(text)) return null
    if (/(?:onrender\.com|vercel\.app|vercel\.com|render\.com|netlify\.app|fly\.dev|railway\.app|heroku\.com)/.test(text)) return null
    if (/twitter\.com\/intent|x\.com\/intent|linkedin\.com\/sharing|linkedin\.com\/share|facebook\.com\/sharer|reddit\.com\/submit/.test(text)) return null
    if (/discord\.gg|t\.me\/|telegram\.me\/|slack\.com\/api|hooks\.slack\.com/.test(text)) return null
    if (/api\.mailchannels\.net|api\.mailgun\.net|api\.postmarkapp\.com|api\.resend\.com/.test(text)) return null
    if (/api\.openai\.com|api\.anthropic\.com|api\.together\.ai|api\.cohere\.ai|api\.groq\.com/.test(text)) return null
    if (/api\.gitlab\.com|gitlab\.com\/api|api\.bitbucket\.org|bitbucket\.org\/api/.test(text)) return null

    // Skip MSW handler files — fixture URLs by design. Only the
    // `__mocks__/` directory and `mocks/handlers*.ts` /
    // `mocks/server*.ts` files; bare `fixtures/` is too broad
    // (matches this analyzer's own test-fixture project).
    if (/(?:[\\/]|^)__mocks__[\\/]/.test(filePath)) return null
    if (/(?:[\\/]|^)mocks[\\/](?:handlers|server|api-)/i.test(filePath)) return null

    // Skip URLs assigned to variables whose names suggest placeholder/example/default values
    if (parent?.type === 'variable_declarator' || parent?.type === 'assignment_expression' || parent?.type === 'pair') {
      const nameNode2 = parent.type === 'pair'
        ? parent.childForFieldName('key')
        : parent.childForFieldName('name')
      const varName2 = nameNode2?.text?.toLowerCase() ?? ''
      if (/placeholder|example|default|fallback|demo|sample|test|mock|stub|dummy/.test(varName2)) return null
    }

    if (/https?:\/\/[a-zA-Z0-9]/.test(text) && !text.includes('example.com') && !text.includes('localhost') && !text.includes('placeholder')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Hardcoded URL',
        `URL \`${text.slice(0, 60)}\` is hardcoded in source. Move it to configuration or environment variables.`,
        sourceCode,
        'Extract the URL to a config constant or environment variable.',
      )
    }
    return null
  },
}
