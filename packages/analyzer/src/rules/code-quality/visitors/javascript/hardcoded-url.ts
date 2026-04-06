import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const hardcodedUrlVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/hardcoded-url',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['string', 'template_string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
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
