import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `slots[0] = a; … slots[0] = b;` — the same element (literal index or key)
 * is assigned twice in one block without being read in between, so the
 * first assignment has no effect. Only plain `=` with literal subscripts is
 * judged; any intervening statement that mentions the receiver counts as a
 * potential read and suppresses the rule.
 */
function literalSubscript(left: SyntaxNode): string | null {
  if (left.type !== 'element_access_expression') return null
  const receiver = left.childForFieldName('expression')
  const subscript = left.childForFieldName('subscript')
  const arg = subscript?.namedChildren[0]?.namedChildren[0]
  if (!receiver || !arg) return null
  if (arg.type !== 'integer_literal' && arg.type !== 'string_literal' && arg.type !== 'character_literal') return null
  return `${receiver.text}[${arg.text}]`
}

export const csharpElementOverwriteVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/element-overwrite',
  languages: ['csharp'],
  nodeTypes: ['block'],
  visit(node, filePath, sourceCode) {
    const statements = node.namedChildren.filter((c) => c && c.type !== 'comment')
    const assigns = new Map<string, { receiver: string; idx: number }>()

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i]!
      if (stmt.type !== 'expression_statement') continue
      const expr = stmt.namedChildren[0]
      if (!expr || expr.type !== 'assignment_expression') continue
      if (expr.childForFieldName('operator')?.text !== '=') continue

      const left = expr.childForFieldName('left')
      if (!left) continue
      const key = literalSubscript(left)
      if (!key) continue

      const prev = assigns.get(key)
      if (prev) {
        let wasRead = false
        for (let j = prev.idx + 1; j < i; j++) {
          if (statements[j]!.text.includes(prev.receiver)) {
            wasRead = true
            break
          }
        }
        // The new right-hand side may also read the previous value
        if (!wasRead && expr.childForFieldName('right')?.text.includes(prev.receiver)) wasRead = true
        if (!wasRead) {
          return makeViolation(
            this.ruleKey, expr, filePath, 'high',
            'Element overwritten before read',
            `\`${key}\` is assigned again before being read — the first assignment has no effect.`,
            sourceCode,
            'Remove the first assignment, fix the index/key, or use the value before overwriting it.',
          )
        }
      }
      assigns.set(key, { receiver: left.childForFieldName('expression')!.text, idx: i })
    }
    return null
  },
}
