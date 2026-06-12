import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Flatten an `&&`/`||` chain into its operand nodes. */
function flattenChain(node: SyntaxNode, op: string, out: SyntaxNode[]): void {
  if (node.type === 'binary_expression' && node.childForFieldName('operator')?.text === op) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (left) flattenChain(left, op, out)
    if (right) flattenChain(right, op, out)
    return
  }
  out.push(node)
}

function normalize(text: string): string {
  return text.replace(/\s+/g, '')
}

/** True when `a` is the logical negation of `b` (`!b` or `!(b)`). */
function isNegationOf(a: string, b: string): boolean {
  return a === `!${b}` || a === `!(${b})`
}

export const csharpContradictoryBooleanExpressionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/contradictory-boolean-expression',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.childForFieldName('operator')?.text
    if (op !== '&&' && op !== '||') return null

    // Only report on the chain root, not on every nested binary_expression.
    const parent = node.parent
    if (parent?.type === 'binary_expression' && parent.childForFieldName('operator')?.text === op) return null

    const operands: SyntaxNode[] = []
    flattenChain(node, op, operands)
    if (operands.length < 2) return null

    const texts = operands.map((o) => normalize(o.text))

    for (let i = 0; i < texts.length; i++) {
      for (let j = 0; j < texts.length; j++) {
        if (i === j) continue
        if (isNegationOf(texts[j]!, texts[i]!)) {
          if (op === '&&') {
            return makeViolation(
              this.ruleKey, node, filePath, 'medium',
              'Contradictory boolean expression',
              `\`${node.text}\` is always \`false\` — a condition AND its negation is a contradiction.`,
              sourceCode,
              'Remove the contradiction — this condition is always false.',
            )
          }
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Tautological boolean expression',
            `\`${node.text}\` is always \`true\` — a condition OR its negation is a tautology.`,
            sourceCode,
            'Remove the tautology — this condition is always true.',
          )
        }
      }
    }

    if (op === '&&' && texts.includes('false')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Contradictory boolean expression',
        `\`${node.text}\` is always \`false\` — anything \`&& false\` is false.`,
        sourceCode,
        'Replace the whole expression with `false`.',
      )
    }
    if (op === '||' && texts.includes('true')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Tautological boolean expression',
        `\`${node.text}\` is always \`true\` — anything \`|| true\` is true.`,
        sourceCode,
        'Replace the whole expression with `true`.',
      )
    }

    return null
  },
}
