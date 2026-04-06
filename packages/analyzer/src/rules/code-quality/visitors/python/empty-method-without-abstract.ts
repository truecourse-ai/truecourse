import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

function isInsideAbcClass(node: SyntaxNode): boolean {
  let cur: SyntaxNode | null = node.parent
  while (cur) {
    if (cur.type === 'class_definition') {
      const args = cur.childForFieldName('superclasses')
      if (args?.text.includes('ABC') || args?.text.includes('ABCMeta')) return true
      return false
    }
    cur = cur.parent
  }
  return false
}

function hasAbstractDecorator(node: SyntaxNode): boolean {
  const decorated = node.parent
  if (!decorated || decorated.type !== 'decorated_definition') return false
  for (let i = 0; i < decorated.childCount; i++) {
    const child = decorated.child(i)
    if (child?.type === 'decorator' && child.text.includes('abstractmethod')) return true
  }
  return false
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
