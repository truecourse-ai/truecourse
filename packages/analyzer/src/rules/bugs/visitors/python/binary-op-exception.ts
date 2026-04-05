import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonBinaryOpExceptionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/binary-op-exception',
  languages: ['python'],
  nodeTypes: ['except_clause'],
  visit(node, filePath, sourceCode) {
    const children = node.children
    const exceptIdx = children.findIndex((c) => c.text === 'except')
    const colonIdx = children.findIndex((c) => c.text === ':')
    if (exceptIdx === -1 || colonIdx === -1) return null

    const typeNodes = children.slice(exceptIdx + 1, colonIdx).filter((c) => c.type !== 'comment' && c.text !== 'as')
    for (const t of typeNodes) {
      if (t.type === 'boolean_operator') {
        const op = t.children.find((c) => c.text === 'or' || c.text === 'and')
        return makeViolation(
          this.ruleKey, t, filePath, 'high',
          'Binary operation on exception in except clause',
          `\`except ${t.text}:\` uses \`${op?.text}\` which evaluates as a boolean expression — only one side is caught. Use a tuple \`except (A, B):\` to catch multiple exceptions.`,
          sourceCode,
          `Change to \`except (${t.children.filter((c) => c.type === 'identifier').map((c) => c.text).join(', ')}):\`.`,
        )
      }
    }
    return null
  },
}
