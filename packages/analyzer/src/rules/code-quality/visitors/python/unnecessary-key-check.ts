import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects patterns like:
 *   if key in d: del d[key]   → use `d.pop(key, None)` or conditional del
 *   if key in d: return d[key] → use d.get(key)
 */
export const pythonUnnecessaryKeyCheckVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-key-check',
  languages: ['python'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    if (!condition || condition.type !== 'comparison_operator') return null

    const condChildren = condition.children
    const inIdx = condChildren.findIndex((c) => c.type === 'in')
    if (inIdx === -1) return null

    const leftNode = condition.namedChildren[0]
    const rightNode = condition.namedChildren[condition.namedChildren.length - 1]
    if (!leftNode || !rightNode) return null

    const key = leftNode.text
    const dictName = rightNode.text

    // Python grammar uses 'consequence' field for the if body (a block node)
    const body = node.childForFieldName('consequence') ?? node.childForFieldName('body')
    if (!body) return null

    const stmts = body.namedChildren.filter((c) => c.type !== 'comment')
    if (stmts.length !== 1) return null

    const stmt = stmts[0]

    // Pattern: if key in d: del d[key]
    if (stmt.type === 'delete_statement') {
      const delTarget = stmt.namedChildren[0]
      if (
        delTarget?.type === 'subscript' &&
        delTarget.childForFieldName('value')?.text === dictName &&
        delTarget.childForFieldName('subscript')?.text === key
      ) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Unnecessary key existence check before del',
          `\`if ${key} in ${dictName}: del ${dictName}[${key}]\` — use \`${dictName}.pop(${key}, None)\` instead.`,
          sourceCode,
          `Replace with \`${dictName}.pop(${key}, None)\`.`,
        )
      }
    }

    return null
  },
}
