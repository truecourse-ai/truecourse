import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUnspecifiedEncodingVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unspecified-encoding',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null
    if (fn.type !== 'identifier' || fn.text !== 'open') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check if 'encoding' keyword argument is present
    const hasEncoding = args.namedChildren.some((a) => {
      if (a.type === 'keyword_argument') {
        const key = a.childForFieldName('name')
        return key?.text === 'encoding'
      }
      return false
    })

    if (hasEncoding) return null

    // Check if it's opened in binary mode (mode='rb', 'wb', etc.)
    const hasBinaryMode = args.namedChildren.some((a) => {
      if (a.type === 'keyword_argument') {
        const key = a.childForFieldName('name')
        if (key?.text !== 'mode') return false
        const val = a.childForFieldName('value')
        return val?.text?.includes('b') ?? false
      }
      // Positional mode argument (second arg)
      return false
    })
    if (hasBinaryMode) return null

    // Check positional mode argument
    const positionalArgs = args.namedChildren.filter((a) => a.type !== 'keyword_argument')
    if (positionalArgs.length >= 2) {
      const modeArg = positionalArgs[1]
      if (modeArg?.text?.includes('b')) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unspecified file encoding',
      '`open()` called without an explicit `encoding` parameter — behavior varies across platforms.',
      sourceCode,
      'Add `encoding="utf-8"` (or another explicit encoding) to the `open()` call.',
    )
  },
}
