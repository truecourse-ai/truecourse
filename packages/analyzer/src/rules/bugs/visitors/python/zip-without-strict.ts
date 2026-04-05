import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonZipWithoutStrictVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/zip-without-strict',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier' || fn.text !== 'zip') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argChildren = args.namedChildren
    // Need at least 2 iterables for zip to be meaningful
    if (argChildren.length < 2) return null

    // Check if strict=True is present
    const hasStrict = argChildren.some((c) => {
      if (c.type === 'keyword_argument') {
        const kw = c.childForFieldName('name')
        return kw?.text === 'strict'
      }
      return false
    })

    if (!hasStrict) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'zip() without strict',
        `\`${node.text}\` silently truncates to the shortest iterable. If the iterables should have equal lengths, pass \`strict=True\` to raise a \`ValueError\` on mismatch.`,
        sourceCode,
        'Add `strict=True` to `zip()` to detect length mismatches: `zip(a, b, strict=True)`.',
      )
    }

    return null
  },
}
