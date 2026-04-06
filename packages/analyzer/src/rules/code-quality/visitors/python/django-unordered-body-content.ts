import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects Django model class bodies not following the recommended ordering:
 * fields → Meta → __str__ → other methods
 */
const ORDER_SCORE: Record<string, number> = {
  field: 0,
  meta: 1,
  dunder: 2,
  method: 3,
}

function getItemScore(node: { type: string; text: string }): number | null {
  if (node.type === 'expression_statement') {
    // Field assignment: name = models.CharField(...)
    const expr = (node as any).namedChildren?.[0]
    if (expr?.type === 'assignment') return ORDER_SCORE.field
    return null
  }
  if (node.type === 'class_definition') {
    const nameNode = (node as any).childForFieldName?.('name')
    if (nameNode?.text === 'Meta') return ORDER_SCORE.meta
    return ORDER_SCORE.method
  }
  if (node.type === 'function_definition' || node.type === 'decorated_definition') {
    const inner = node.type === 'decorated_definition' ? (node as any).namedChildren?.find((c: any) => c.type === 'function_definition') : node
    const nameNode = inner?.childForFieldName?.('name')
    if (!nameNode) return ORDER_SCORE.method
    const name = nameNode.text
    if (name === '__str__' || name === '__repr__' || name === '__unicode__') return ORDER_SCORE.dunder
    return ORDER_SCORE.method
  }
  return null
}

export const pythonDjangoUnorderedBodyContentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/django-unordered-body-content',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    // Check if class inherits from models.Model or similar
    const args = node.childForFieldName('superclasses')
    if (!args) return null
    const superclassText = args.text
    if (!superclassText.includes('Model') && !superclassText.includes('models')) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const items = body.namedChildren.filter((c) => c.type !== 'comment' && c.type !== 'pass_statement')
    const scores: number[] = []
    for (const item of items) {
      const score = getItemScore(item as any)
      if (score !== null) scores.push(score)
    }

    for (let i = 1; i < scores.length; i++) {
      if (scores[i] < scores[i - 1]) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Django model body not ordered',
          'Django model class body should follow the recommended ordering: fields, then Meta class, then __str__/dunder methods, then other methods.',
          sourceCode,
          'Reorder the model body: fields first, then the Meta class, then __str__, then other methods.',
        )
      }
    }

    return null
  },
}
