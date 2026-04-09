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

    // Skip URLs inside JSX placeholder/descriptive attributes
    const parent = node.parent
    if (parent?.type === 'jsx_attribute') {
      const attrName = parent.childForFieldName('name')?.text ?? ''
      if (/^(placeholder|aria-label|aria-description|title|alt)$/.test(attrName)) return null
    }

    // Skip URLs in variable assignments where variable name indicates a placeholder/config default
    if (parent?.type === 'variable_declarator' || parent?.type === 'assignment_expression' || parent?.type === 'pair') {
      const nameNode = parent.type === 'pair'
        ? parent.childForFieldName('key')
        : parent.childForFieldName('name')
      const varName = nameNode?.text?.toLowerCase() ?? ''
      if (/default|placeholder|example|sample|template/.test(varName)) return null
    }

    if (/https?:\/\/[a-zA-Z0-9]/.test(text) && !text.includes('example.com') && !text.includes('localhost')) {
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
