import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

/**
 * sonarjs/S6079 (no-code-after-done)
 * Detects code executed after done() callback is called in a test.
 */
function findDoneCallIndex(stmts: SyntaxNode[]): number {
  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i]
    // Direct done() call
    if (stmt.type === 'expression_statement') {
      const expr = stmt.namedChildren[0]
      if (expr?.type === 'call_expression') {
        const fn = expr.childForFieldName('function')
        if (fn?.type === 'identifier' && fn.text === 'done') {
          return i
        }
      }
    }
  }
  return -1
}

function hasDoneParameter(node: SyntaxNode): boolean {
  const params = node.childForFieldName('parameters') ?? node.childForFieldName('formal_parameters')
  if (!params) return false
  return params.namedChildren.some((p) => {
    const name = p.type === 'identifier' ? p.text : p.childForFieldName('pattern')?.text ?? p.namedChildren[0]?.text
    return name === 'done'
  })
}

function isTestCallback(node: SyntaxNode): boolean {
  // The arrow_function (or function) is a direct child of an arguments node,
  // which is itself a child of the call_expression.
  const parent = node.parent
  if (!parent) return false
  const callNode = parent.type === 'arguments' ? parent.parent : parent
  if (!callNode || callNode.type !== 'call_expression') return false
  const fn = callNode.childForFieldName('function')
  if (!fn) return false
  let fnName = ''
  if (fn.type === 'identifier') fnName = fn.text
  else if (fn.type === 'member_expression') {
    fnName = fn.childForFieldName('property')?.text ?? ''
  }
  return fnName === 'it' || fnName === 'test'
}

export const testCodeAfterDoneVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/test-code-after-done',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['arrow_function', 'function'],
  visit(node, filePath, sourceCode) {
    if (!isTestCallback(node)) return null
    if (!hasDoneParameter(node)) return null

    const body = node.childForFieldName('body')
    if (!body || body.type !== 'statement_block') return null

    const stmts = body.namedChildren
    const doneIdx = findDoneCallIndex(stmts)
    if (doneIdx < 0 || doneIdx === stmts.length - 1) return null

    // There are statements after done()
    const afterDone = stmts[doneIdx + 1]
    return makeViolation(
      this.ruleKey, afterDone, filePath, 'medium',
      'Code after done() callback',
      'Code is executed after `done()` is called. `done()` signals test completion — subsequent code may not execute reliably.',
      sourceCode,
      'Move all code before calling `done()`, or use async/await instead of the `done` callback.',
    )
  },
}
