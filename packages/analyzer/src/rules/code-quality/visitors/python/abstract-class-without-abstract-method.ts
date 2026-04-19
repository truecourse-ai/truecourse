import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasDecoratorNamed, getPythonDecoratorName } from '../../../_shared/python-helpers.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

function inheritsFromABC(node: SyntaxNode): boolean {
  const supers = node.childForFieldName('superclasses')
  if (!supers) return false
  for (const child of supers.namedChildren) {
    const baseName = extractBaseName(child)
    if (baseName === 'ABC' || baseName === 'ABCMeta') return true
  }
  return false
}

function extractBaseName(node: SyntaxNode): string | null {
  if (node.type === 'identifier') return node.text
  if (node.type === 'attribute') {
    const attr = node.childForFieldName('attribute')
    return attr?.text ?? null
  }
  if (node.type === 'subscript') {
    const value = node.childForFieldName('value')
    if (value) return extractBaseName(value)
  }
  if (node.type === 'keyword_argument') return null
  return null
}

function hasAbstractMethod(classBody: SyntaxNode): boolean {
  for (let i = 0; i < classBody.childCount; i++) {
    const child = classBody.child(i)
    if (!child) continue
    if (child.type === 'function_definition' && hasDecoratorNamed(child, 'abstractmethod')) return true
    if (child.type === 'decorated_definition') {
      // Check decorators on the decorated_definition itself
      const decs = child.namedChildren.filter((c) => c.type === 'decorator')
      if (decs.some((d) => getPythonDecoratorName(d) === 'abstractmethod')) return true
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
