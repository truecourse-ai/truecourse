import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

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
