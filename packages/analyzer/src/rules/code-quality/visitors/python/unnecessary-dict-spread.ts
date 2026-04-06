import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUnnecessaryDictSpreadVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-dict-spread',
  languages: ['python'],
  nodeTypes: ['dictionary'],
  visit(node, filePath, sourceCode) {
    // Detect {**d} — dict with only a double splat and nothing else
    const children = node.namedChildren
    if (children.length !== 1) return null

    const only = children[0]
    if (!only || only.type !== 'dictionary_splat') return null

    const inner = only.namedChildren[0]?.text ?? 'd'

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unnecessary dict spread',
      `\`{**${inner}}\` when you only need a copy — use \`${inner}.copy()\` instead.`,
      sourceCode,
      `Replace \`{**${inner}}\` with \`${inner}.copy()\`.`,
    )
  },
}
