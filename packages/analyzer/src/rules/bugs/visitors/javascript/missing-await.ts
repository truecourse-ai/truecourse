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
  visit(node, filePath, sourceCode) {
    const value = node.childForFieldName('value')
    if (!value || value.type !== 'call_expression') return null

    // Check it's not already awaited
    if (node.parent?.type === 'await_expression') return null

    const fn = value.childForFieldName('function')
    if (!fn) return null

    // Heuristic: calls to functions ending in Async or common async patterns
    const fnText = fn.text
    if (!fnText.endsWith('Async') && !fnText.match(/^(fetch|axios\.|request|readFile|writeFile|connect|query|findOne|find|save|update|delete|create|send|get|post|put)/)) {
      return null
    }

    if (!isInsideAsyncFunction(node)) return null

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
