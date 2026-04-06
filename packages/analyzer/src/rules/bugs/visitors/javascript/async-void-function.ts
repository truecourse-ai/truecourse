import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Detect: async function/arrow called without await and without .catch() or try/catch
// Pattern: expression_statement containing call_expression where the called function is async
// Heuristic: call_expression that is a direct statement (not awaited, not .then/.catch)

function isAsyncCallStatement(node: SyntaxNode): boolean {
  // node is expression_statement
  const expr = node.namedChildren[0]
  if (!expr || expr.type !== 'call_expression') return false

  // Not awaited
  if (node.parent?.type === 'await_expression') return false

  // Check the function being called - if it ends with Async or is known async pattern
  const fn = expr.childForFieldName('function')
  if (!fn) return false

  // Heuristic: caller ends in Async suffix or the call is chained .then/.catch
  // We flag: standalone call_expression statements that call async functions
  // We detect if the call is chained to .catch or .then
  if (fn.type === 'member_expression') {
    const prop = fn.childForFieldName('property')
    if (prop && (prop.text === 'catch' || prop.text === 'then' || prop.text === 'finally')) return false
  }

  return true
}

export const asyncVoidFunctionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/async-void-function',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    // Check if parent is expression_statement (not assignment, not await, not return)
    const parent = node.parent
    if (!parent || parent.type !== 'expression_statement') return null

    // Check if the call itself is awaited
    // Already excluded if parent is expression_statement and not await_expression

    // Look for calls to identifiers ending in "Async" (heuristic for async functions)
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Detect: void someAsyncFn() pattern (void operator)
    // Actually detect: direct call statements to functions named *Async or that start with async patterns
    // Better heuristic: look for the function name or pattern

    // Check if there's a .catch() chained - if so, it's handled
    // This visitor detects: asyncFn() as a standalone statement (fire-and-forget)
    // We check grandparent context to see if we're in a function marked async

    // Only flag calls that look like they should be awaited
    // We look for common patterns: functions named with "Async" suffix or common async names
    const fnText = fn.text
    if (!fnText.endsWith('Async') && !fnText.match(/^(fetch|axios|request|save|load|upload|download|send|get|post|put|delete|update|create|init|connect|disconnect|start|stop|run|exec|execute)/i)) {
      return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Async function called without await',
      `\`${fnText}()\` looks like an async function but is called without \`await\` — errors will be silently swallowed. Add \`await\` or attach \`.catch()\`.`,
      sourceCode,
      'Add `await` before the call, or attach `.catch(err => ...)` to handle errors.',
    )
  },
}
