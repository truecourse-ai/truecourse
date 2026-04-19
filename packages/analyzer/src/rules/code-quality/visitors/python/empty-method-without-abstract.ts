import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasDecoratorNamed } from '../../../_shared/python-helpers.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

function isInsideAbcClass(node: SyntaxNode): boolean {
  let cur: SyntaxNode | null = node.parent
  while (cur) {
    if (cur.type === 'class_definition') {
      const supers = cur.childForFieldName('superclasses')
      if (!supers) return false
      for (const child of supers.namedChildren) {
        const baseName = extractBaseName(child)
        if (baseName === 'ABC' || baseName === 'ABCMeta') return true
      }
      return false
    }
    cur = cur.parent
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

function hasAbstractDecorator(node: SyntaxNode): boolean {
  return hasDecoratorNamed(node, 'abstractmethod')
}

function isEmptyBody(bodyNode: SyntaxNode): boolean {
  const stmts = bodyNode.namedChildren
  if (stmts.length === 0) return true
  if (stmts.length === 1) {
    const s = stmts[0]
    if (s.type === 'pass_statement') return true
    if (s.type === 'expression_statement') {
      const expr = s.namedChildren[0]
      if (expr?.type === 'ellipsis') return true
      if (expr?.type === 'string') return true // docstring only
    }
  }
  return false
}

export const pythonEmptyMethodWithoutAbstractVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/empty-method-without-abstract',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    if (!isInsideAbcClass(node)) return null
    if (hasAbstractDecorator(node)) return null

    const bodyNode = node.childForFieldName('body')
    if (!bodyNode || !isEmptyBody(bodyNode)) return null

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text || 'method'
    if (name.startsWith('__') && name.endsWith('__')) return null // skip dunder methods

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Empty method without @abstractmethod',
      `Method \`${name}\` in an ABC has an empty body but is missing \`@abstractmethod\` — subclasses are not forced to implement it.`,
      sourceCode,
      'Add the `@abstractmethod` decorator to enforce implementation in subclasses.',
    )
  },
}
