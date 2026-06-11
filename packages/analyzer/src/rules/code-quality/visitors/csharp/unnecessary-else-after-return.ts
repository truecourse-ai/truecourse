import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

function endsWithReturn(block: SyntaxNode): boolean {
  if (block.type === 'return_statement') return true
  if (block.type === 'block') {
    const stmts = block.namedChildren
    const last = stmts[stmts.length - 1]
    if (last && last.type === 'return_statement') return true
  }
  return false
}

function getReturnValue(block: SyntaxNode): string | null {
  let target = block
  if (target.type === 'block') {
    const stmts = target.namedChildren
    if (stmts.length !== 1 || stmts[0]?.type !== 'return_statement') return null
    target = stmts[0]!
  }
  if (target.type !== 'return_statement') return null
  const value = target.namedChildren[0]
  return value?.text ?? null
}

export const csharpUnnecessaryElseAfterReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-else-after-return',
  languages: ['csharp'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const consequence = node.childForFieldName('consequence')
    const alternative = node.childForFieldName('alternative')
    if (!consequence || !alternative) return null

    // `else if` chains are a single dispatch construct, not removable elses.
    if (alternative.type === 'if_statement') return null

    if (endsWithReturn(consequence)) {
      const trueVal = getReturnValue(consequence)
      const falseVal = getReturnValue(alternative)
      if ((trueVal === 'true' && falseVal === 'false') || (trueVal === 'false' && falseVal === 'true')) {
        return null // prefer-single-boolean-return covers this shape
      }

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unnecessary else after return',
        'The else block is unnecessary because the if branch returns. Move the else body to the outer scope.',
        sourceCode,
        'Remove the else wrapper — the code after the if block will only run when the condition is false.',
      )
    }
    return null
  },
}
