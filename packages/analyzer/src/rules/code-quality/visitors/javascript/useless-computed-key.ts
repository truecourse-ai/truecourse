import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const uselessComputedKeyVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-computed-key',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['pair'],
  visit(node, filePath, sourceCode) {
    const key = node.childForFieldName('key')
    if (!key) return null

    if (key.type !== 'computed_property_name') return null

    const inner = key.namedChildren[0]
    if (!inner) return null

    if (inner.type === 'string') {
      const strVal = inner.text.slice(1, -1)
      if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(strVal)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Useless computed property key',
          `\`[${inner.text}]\` is a computed key with a string literal — use \`${strVal}\` directly.`,
          sourceCode,
          `Replace \`[${inner.text}]\` with \`${strVal}\`.`,
        )
      }
    }
    return null
  },
}
