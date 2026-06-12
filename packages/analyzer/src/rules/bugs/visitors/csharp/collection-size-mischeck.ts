import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Size checks that are always constant:
 *   - `arr.Length == null` / `!= null` — Length is a non-nullable int
 *     (compiles with warning CS0472 that is routinely suppressed)
 *   - `list.Count < 0` / `arr.Length < 0` — counts are never negative
 *
 * `Count == null` is deliberately NOT flagged: a custom `int? Count` DTO
 * property makes that comparison meaningful.
 */
function sizeProp(n: SyntaxNode, names: Set<string>): string | null {
  if (n.type !== 'member_access_expression') return null
  const name = n.childForFieldName('name')?.text
  return name && names.has(name) ? name : null
}

export const csharpCollectionSizeMischeckVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/collection-size-mischeck',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const op = node.childForFieldName('operator')?.text
    if (!left || !right || !op) return null

    // `.Length == null` is always false (Length is int)
    if (op === '==' || op === '!=') {
      const lengthSide =
        sizeProp(left, new Set(['Length'])) && right.type === 'null_literal' ? left
        : sizeProp(right, new Set(['Length'])) && left.type === 'null_literal' ? right
        : null
      if (lengthSide) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Collection size mischeck',
          `\`${lengthSide.text} ${op} null\` is always ${op === '==' ? 'false' : 'true'} — Length is a non-nullable int. Did you mean \`${lengthSide.text} ${op === '==' ? '== 0' : '> 0'}\`?`,
          sourceCode,
          `Compare against 0: \`${lengthSide.text} > 0\` checks for a non-empty collection.`,
        )
      }
    }

    // `.Count < 0` / `.Length < 0` is always false
    if (op === '<' && right.type === 'integer_literal' && right.text === '0') {
      const prop = sizeProp(left, new Set(['Length', 'Count']))
      if (prop) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Collection size mischeck',
          `\`${left.text} < 0\` is always false — ${prop} is never negative. Did you mean \`== 0\`?`,
          sourceCode,
          `Replace with \`${left.text} == 0\` to check for an empty collection.`,
        )
      }
    }

    return null
  },
}
