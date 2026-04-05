import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonRedundantTupleInExceptionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/redundant-tuple-in-exception',
  languages: ['python'],
  nodeTypes: ['except_clause'],
  visit(node, filePath, sourceCode) {
    // Find the caught type — look for a tuple with exactly one element
    const children = node.children
    const exceptIdx = children.findIndex((c) => c.text === 'except')
    const colonIdx = children.findIndex((c) => c.text === ':')
    if (exceptIdx === -1 || colonIdx === -1) return null

    const typeNodes = children.slice(exceptIdx + 1, colonIdx).filter((c) => c.type !== 'comment' && c.text !== 'as')
    for (const t of typeNodes) {
      if (t.type === 'tuple' && t.namedChildren.length === 1) {
        return makeViolation(
          this.ruleKey, t, filePath, 'low',
          'Redundant tuple in except handler',
          `\`except (${t.namedChildren[0].text},):\` has an unnecessary trailing comma — use \`except ${t.namedChildren[0].text}:\` instead.`,
          sourceCode,
          `Remove the trailing comma: \`except ${t.namedChildren[0].text}:\`.`,
        )
      }
    }
    return null
  },
}
