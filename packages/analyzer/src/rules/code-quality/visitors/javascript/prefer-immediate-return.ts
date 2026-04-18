import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES, getFunctionBody } from './_helpers.js'
import type { SyntaxNode } from 'tree-sitter'

export const preferImmediateReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-immediate-return',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    const stmts = bodyNode.namedChildren
    if (stmts.length < 2) return null

    const last = stmts[stmts.length - 1]
    const secondLast = stmts[stmts.length - 2]

    if (last.type !== 'return_statement') return null
    const retVal = last.namedChildren[0]
    if (!retVal || retVal.type !== 'identifier') return null
    const retName = retVal.text

    if (secondLast.type !== 'variable_declaration' && secondLast.type !== 'lexical_declaration') return null
    const declarators = secondLast.namedChildren.filter((c) => c.type === 'variable_declarator')
    if (declarators.length !== 1) return null
    const decl = declarators[0]
    const nameNode = decl.childForFieldName('name')
    if (nameNode?.text !== retName) return null

    let usageCount = 0
    function countUsages(n: SyntaxNode) {
      if (n.type === 'identifier' && n.text === retName) {
        const parent = n.parent
        if (parent?.type === 'variable_declarator' && parent.childForFieldName('name')?.id === n.id) return
        usageCount++
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) countUsages(child)
      }
    }
    countUsages(bodyNode)

    if (usageCount === 1) {
      return makeViolation(
        this.ruleKey, secondLast, filePath, 'low',
        'Prefer immediate return',
        `Variable \`${retName}\` is assigned and immediately returned — return the expression directly.`,
        sourceCode,
        `Replace \`const ${retName} = expr; return ${retName};\` with \`return expr;\`.`,
      )
    }
    return null
  },
}
