import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

function hasAbstractDecorator(funcNode: SyntaxNode): boolean {
  const decorated = funcNode.parent
  if (!decorated || decorated.type !== 'decorated_definition') return false
  for (let i = 0; i < decorated.childCount; i++) {
    const child = decorated.child(i)
    if (!child || child.type !== 'decorator') continue
    const text = child.text
    if (text.includes('abstractmethod')) return true
  }
  return false
}

function inheritsFromABC(node: SyntaxNode): boolean {
  const args = node.childForFieldName('superclasses')
  if (!args) return false
  const text = args.text
  return text.includes('ABC') || text.includes('ABCMeta')
}

function hasAbstractMethod(classBody: SyntaxNode): boolean {
  for (let i = 0; i < classBody.childCount; i++) {
    const child = classBody.child(i)
    if (!child) continue
    if (child.type === 'function_definition' && hasAbstractDecorator(child)) return true
    if (child.type === 'decorated_definition') {
      const func = child.namedChildren.find((c) => c.type === 'function_definition')
      if (func && hasAbstractDecorator(func)) return true
      // Check decorator text
      for (let j = 0; j < child.childCount; j++) {
        const dec = child.child(j)
        if (dec && dec.type === 'decorator' && dec.text.includes('abstractmethod')) return true
      }
    }
  }
  return false
}

export const pythonAbstractClassWithoutAbstractMethodVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/abstract-class-without-abstract-method',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    if (!inheritsFromABC(node)) return null

    const bodyNode = node.childForFieldName('body')
    if (!bodyNode) return null

    if (hasAbstractMethod(bodyNode)) return null

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text || 'class'

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Abstract class without abstract method',
      `Class \`${name}\` inherits from ABC but defines no \`@abstractmethod\` — subclasses are not forced to implement anything.`,
      sourceCode,
      'Add at least one method decorated with `@abstractmethod`, or remove the ABC base class.',
    )
  },
}
