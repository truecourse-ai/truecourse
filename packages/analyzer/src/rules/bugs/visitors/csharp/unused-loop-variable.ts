import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `foreach (var item in items)` where `item` is never read in the body —
 * the loop only counts iterations. C# convention is to name the variable
 * `_` (or `_`-prefixed) to signal the intentional discard.
 */
export const csharpUnusedLoopVariableVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unused-loop-variable',
  languages: ['csharp'],
  nodeTypes: ['foreach_statement'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const body = node.childForFieldName('body')
    if (!left || !body || left.type !== 'identifier') return null

    const varName = left.text
    if (varName.startsWith('_')) return null

    let used = false
    const walk = (n: SyntaxNode): void => {
      if (used) return
      if (n.type === 'identifier' && n.text === varName) {
        used = true
        return
      }
      for (const child of n.namedChildren) {
        if (child) walk(child)
      }
    }
    walk(body)
    if (used) return null

    return makeViolation(
      this.ruleKey, left, filePath, 'low',
      'Unused loop control variable',
      `Loop variable \`${varName}\` is never used in the loop body — rename it to \`_\` to make the intentional discard explicit.`,
      sourceCode,
      `Replace \`${varName}\` with \`_\` to make it clear the loop variable is intentionally unused.`,
    )
  },
}
