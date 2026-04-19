import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonDjangoReceiverDecoratorOrderVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/django-receiver-decorator-order',
  languages: ['python'],
  nodeTypes: ['decorated_definition'],
  visit(node, filePath, sourceCode) {
    // Collect decorators in order
    const decorators: string[] = []
    let receiverIndex = -1
    let i = 0

    for (const child of node.children) {
      if (child.type === 'decorator') {
        const name = getDecoratorName(child)
        decorators.push(name)
        if (name === 'receiver' || name.endsWith('.receiver')) {
          receiverIndex = i
        }
        i++
      }
    }

    if (receiverIndex === -1) return null // No @receiver
    if (decorators.length === 1) return null // Only @receiver, fine
    if (receiverIndex === 0) return null // @receiver is first (outermost) — correct

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      '@receiver decorator not outermost',
      '`@receiver` must be the outermost decorator — placing it inside causes the signal handler to silently fail.',
      sourceCode,
      'Move `@receiver` to be the first (outermost) decorator.',
    )
  },
}

function getDecoratorName(decorator: import('web-tree-sitter').Node): string {
  for (const child of decorator.namedChildren) {
    if (child.type === 'identifier') return child.text
    if (child.type === 'attribute') {
      const attr = child.childForFieldName('attribute')
      return attr?.text ?? child.text
    }
    if (child.type === 'call') {
      const fn = child.childForFieldName('function')
      if (fn?.type === 'identifier') return fn.text
      if (fn?.type === 'attribute') {
        const attr = fn.childForFieldName('attribute')
        return attr?.text ?? fn.text
      }
    }
  }
  return ''
}
