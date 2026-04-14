import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonFlaskSecretKeyDisclosedVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/flask-secret-key-disclosed',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')

    if (!left || !right) return null

    const leftText = left.text

    // app.secret_key = "hardcoded" or app.config['SECRET_KEY'] = "hardcoded"
    // or SECRET_KEY = "hardcoded"
    const isSecretKey = leftText === 'SECRET_KEY' ||
      leftText.endsWith('.secret_key') ||
      leftText.includes("['SECRET_KEY']") ||
      leftText.includes('["SECRET_KEY"]')

    if (!isSecretKey) return null

    // Flag if the value is a string literal
    if (right.type === 'string' || right.type === 'concatenated_string') {
      const val = right.text.replace(/^['"]+|['"]+$/g, '')
      // Ignore env var references
      if (!val.includes('environ') && !val.includes('getenv') && val.length >= 1) {
        return makeViolation(
          this.ruleKey, node, filePath, 'critical',
          'Flask SECRET_KEY hardcoded',
          `Flask SECRET_KEY is hardcoded as a string literal. This compromises session security.`,
          sourceCode,
          'Load the SECRET_KEY from an environment variable: app.secret_key = os.environ["SECRET_KEY"].',
        )
      }
    }

    return null
  },
}
