import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

function getLoopVarNames(node: SyntaxNode): string[] {
  if (node.type === 'for_statement') {
    const left = node.childForFieldName('left')
    if (!left) return []
    if (left.type === 'identifier') return [left.text]
    if (left.type === 'tuple_pattern' || left.type === 'list_pattern') {
      return left.namedChildren.filter((c) => c.type === 'identifier').map((c) => c.text)
    }
  }
  return []
}

function findAssignments(bodyNode: SyntaxNode, varNames: Set<string>): SyntaxNode | null {
  for (let i = 0; i < bodyNode.childCount; i++) {
    const child = bodyNode.child(i)
    if (!child) continue
    if (child.type === 'assignment') {
      const left = child.childForFieldName('left')
      if (left?.type === 'identifier' && varNames.has(left.text)) return child
    }
    if (child.type === 'augmented_assignment') {
      const left = child.childForFieldName('left')
      if (left?.type === 'identifier' && varNames.has(left.text)) return child
    }
  }
  return null
}

export const pythonRedefinedLoopNameVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redefined-loop-name',
  languages: ['python'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const varNames = getLoopVarNames(node)
    if (varNames.length === 0) return null

    const bodyNode = node.childForFieldName('body')
    if (!bodyNode) return null

    const varSet = new Set(varNames)
    const violation = findAssignments(bodyNode, varSet)
    if (!violation) return null

    const left = violation.childForFieldName('left')
    const name = left?.text || varNames[0]

    return makeViolation(
      this.ruleKey, violation, filePath, 'low',
      'Loop variable redefined in body',
      `Loop variable \`${name}\` is reassigned inside the loop body — this is likely a bug or confusing.`,
      sourceCode,
      'Use a different variable name inside the loop body instead of reusing the loop variable.',
    )
  },
}
