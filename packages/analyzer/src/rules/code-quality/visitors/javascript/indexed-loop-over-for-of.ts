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

    // Only flag when the upper bound is `<expr>.length`. A loop whose upper
    // bound is a plain count or externally-tracked cursor (e.g.
    // `i < currentRecipientIndex`) does a partial pass; replacing it with
    // `for...of` would iterate the whole array and change the loop's range.
    function isLengthBound(expr: SyntaxNode | null): boolean {
      if (!expr) return false
      if (expr.type === 'parenthesized_expression') {
        return isLengthBound(expr.namedChild(0))
      }
      if (expr.type === 'member_expression') {
        return expr.childForFieldName('property')?.text === 'length'
      }
      return false
    }
    const cmp = condition.type === 'binary_expression' ? condition : null
    if (!cmp) return null
    const left = cmp.childForFieldName('left')
    const right = cmp.childForFieldName('right')
    const indexIsLeft = left?.type === 'identifier' && left.text === indexName
    const boundExpr = indexIsLeft ? right : left
    if (!isLengthBound(boundExpr ?? null)) return null

    let usedOutsideIndex = false
    let usedAsArrayIndex = false
    function checkIndexUsage(n: SyntaxNode) {
      if (usedOutsideIndex) return
      if (n.type === 'identifier' && n.text === indexName) {
        const parent = n.parent
        if (parent?.type === 'subscript_expression' && parent.childForFieldName('index')?.id === n.id) {
          usedAsArrayIndex = true
          return
        }
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

    // Only flag when the loop body actually uses the index for array access.
    // A counted loop that never indexes any array (e.g. iterates a fixed
    // numeric upper bound for retry/window logic) cannot be replaced with
    // `for...of` — there's no array to iterate over.
    if (!usedOutsideIndex && usedAsArrayIndex) {
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
