import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from './_helpers.js'

export const indexedLoopOverForOfVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/indexed-loop-over-for-of',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const initializer = node.childForFieldName('initializer')
    const condition = node.childForFieldName('condition')
    const increment = node.childForFieldName('increment')
    const body = node.childForFieldName('body')

    if (!initializer || !condition || !increment || !body) return null

    if (initializer.type !== 'lexical_declaration' && initializer.type !== 'variable_declaration') return null
    const declarator = initializer.namedChildren.find((c) => c.type === 'variable_declarator')
    if (!declarator) return null
    const indexNameNode = declarator.childForFieldName('name')
    const initValue = declarator.childForFieldName('value')
    if (!indexNameNode || initValue?.text !== '0') return null
    const indexName = indexNameNode.text

    const isIncrement = increment.type === 'update_expression'
      && increment.text.includes(indexName)
    if (!isIncrement) return null

    const condText = condition.text
    if (!condText.includes(indexName)) return null

    // Skip when the loop condition uses arithmetic on .length (e.g., arr.length - 1)
    // indicating a partial range iteration that for-of cannot replicate
    const lengthArithmeticRe = /\.length\s*[-+*/]/
    if (lengthArithmeticRe.test(condText)) return null

    let usedOutsideIndex = false
    function checkIndexUsage(n: SyntaxNode) {
      if (usedOutsideIndex) return
      if (n.type === 'identifier' && n.text === indexName) {
        const parent = n.parent
        if (parent?.type === 'subscript_expression' && parent.childForFieldName('index')?.id === n.id) return
        if (parent?.id === condition?.id || parent?.id === increment?.id) return
        let p: SyntaxNode | null = n.parent
        while (p) {
          if (p.id === condition?.id || p.id === increment?.id || p.id === initializer?.id) return
          p = p.parent
        }
        usedOutsideIndex = true
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) checkIndexUsage(child)
      }
    }

    checkIndexUsage(body)

    if (!usedOutsideIndex) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Indexed loop when index not needed',
        `Index variable \`${indexName}\` is only used for array access. Use \`for...of\` instead.`,
        sourceCode,
        `Replace with \`for (const item of arr) { ... }\`.`,
      )
    }
    return null
  },
}
