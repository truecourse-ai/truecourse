import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { FORMAT_SPEC_RE, VALID_FORMAT_CHARS } from './_helpers.js'

export const pythonBadStringFormatCharacterVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/bad-string-format-character',
  languages: ['python'],
  nodeTypes: ['binary_operator'],
  visit(node, filePath, sourceCode) {
    const op = node.children.find((c) => c.text === '%')
    if (!op) return null

    const left = node.childForFieldName('left')
    if (!left || left.type !== 'string') return null

    // Extract the raw string content
    const raw = left.text
    // Remove quotes and prefix
    const content = raw.replace(/^[bBuUrRfF]*['"]+'/, '').replace(/['"]+$/, '')

    let match: RegExpExecArray | null
    FORMAT_SPEC_RE.lastIndex = 0
    while ((match = FORMAT_SPEC_RE.exec(content)) !== null) {
      const convChar = match[3]
      if (convChar !== '%' && !VALID_FORMAT_CHARS.has(convChar)) {
        return makeViolation(
          this.ruleKey, left, filePath, 'high',
          'Invalid % format character',
          `\`${left.text}\` contains an invalid format character \`%${convChar}\` — this will raise a \`ValueError\` at runtime.`,
          sourceCode,
          `Use a valid conversion character: %s (string), %d (int), %f (float), %r (repr), etc.`,
        )
      }
    }
    return null
  },
}
