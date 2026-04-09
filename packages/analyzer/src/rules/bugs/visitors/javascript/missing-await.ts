import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Detect: variable assignment where an async function result is stored but not awaited
// Pattern: const result = someAsyncFn() (without await) inside an async function

function isInsideAsyncFunction(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (
      (current.type === 'function_declaration' || current.type === 'function_expression' || current.type === 'arrow_function') &&
      current.children.some(c => c.type === 'async')
    ) {
      return true
    }
    current = current.parent
  }
  return false
}

export const missingAwaitVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/missing-await',
  languages: JS_LANGUAGES,
  nodeTypes: ['variable_declarator'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    const value = node.childForFieldName('value')
    if (!value || value.type !== 'call_expression') return null

    if (!isInsideAsyncFunction(node)) return null

    // Check if the call expression returns a Promise using the type system
    const isPromise = typeQuery.isPromiseLike(
      filePath,
      value.startPosition.row,
      value.startPosition.column,
      value.endPosition.row,
      value.endPosition.column,
    )
    if (!isPromise) return null

    // Skip when the result is used as a subquery — passed to another call or template
    const fn = value.childForFieldName('function')
    const nameNode2 = node.childForFieldName('name')
    if (nameNode2?.type === 'identifier') {
      const varName2 = nameNode2.text
      const parentBlock = node.parent?.parent
      if (parentBlock) {
        // Check if the variable is used in a template tag or as argument to another call
        const blockText = parentBlock.text
        if (blockText.includes(`\${${varName2}}`) || new RegExp(`\\(.*\\b${varName2}\\b.*\\)`).test(blockText)) {
          // Variable is composed into another expression — likely a subquery
          return null
        }
      }
    }

    const fnText = fn?.text ?? 'fn'
    const nameNode = node.childForFieldName('name')
    const varName = nameNode?.text ?? 'result'

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Missing await on async call',
      `\`${varName}\` is assigned the result of \`${fnText}()\` without \`await\` — it will hold a Promise instead of the resolved value.`,
      sourceCode,
      `Add \`await\` before the call: \`const ${varName} = await ${fnText}(...)\`.`,
    )
  },
}
