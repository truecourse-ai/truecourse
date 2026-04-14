import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

// Detect: for x in iterable: if x: return True / return False → use any()
// For simplicity, detect: for x in ...: result = result or/and x → use any()/all()
function isSimpleAccumulator(bodyNode: SyntaxNode): { kind: 'any' | 'all' | 'sum' | 'min' | 'max'; iterVar: string } | null {
  const stmts = bodyNode.namedChildren
  if (stmts.length !== 1) return null
  // augmented assignment: result += x, result = result or x
  const stmt = stmts[0]
  if (stmt.type === 'if_statement') {
    const consequence = stmt.childForFieldName('consequence')
    if (!consequence) return null
    const consStmts = consequence.namedChildren
    if (consStmts.length !== 1) return null
    if (consStmts[0].type === 'return_statement') {
      const retVal = consStmts[0].namedChildren[0]
      if (retVal?.text === 'True') {
        return { kind: 'any', iterVar: '' }
      }
      if (retVal?.text === 'False') {
        return { kind: 'all', iterVar: '' }
      }
    }
  }
  return null
}

export const pythonReimplementedBuiltinVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/reimplemented-builtin',
  languages: ['python'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const bodyNode = node.childForFieldName('body')
    if (!bodyNode) return null

    const result = isSimpleAccumulator(bodyNode)
    if (!result) return null

    const right = node.childForFieldName('right')
    const iterText = right?.text || 'iterable'

    if (result.kind === 'any') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Reimplemented any()',
        `This loop reimplements \`any()\`. Use \`any(condition for x in ${iterText})\` instead.`,
        sourceCode,
        `Replace with \`return any(condition for x in ${iterText})\`.`,
      )
    }
    if (result.kind === 'all') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Reimplemented all()',
        `This loop reimplements \`all()\`. Use \`all(condition for x in ${iterText})\` instead.`,
        sourceCode,
        `Replace with \`return all(condition for x in ${iterText})\`.`,
      )
    }
    return null
  },
}
