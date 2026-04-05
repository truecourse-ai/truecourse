import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: Flask class-based view (MethodView/View subclass) with route decorators
// applied directly to the class instead of using the `decorators` class attribute

function extendsFlaskView(classNode: SyntaxNode): boolean {
  const args = classNode.childForFieldName('superclasses')
  if (!args) return false
  const text = args.text
  return text.includes('MethodView') || text.includes('View') || text.includes('FlaskView')
}

function hasDirectRouteDecorator(classNode: SyntaxNode): boolean {
  let current: SyntaxNode | null = classNode.parent
  if (!current || current.type !== 'decorated_definition') return false

  for (const child of current.namedChildren) {
    if (child.type !== 'decorator') continue
    if (child.text.includes('route') || child.text.includes('app.') || child.text.includes('bp.')) {
      return true
    }
  }
  return false
}

export const pythonFlaskClassViewDecoratorWrongVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/flask-class-view-decorator-wrong',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    if (!extendsFlaskView(node)) return null
    if (!hasDirectRouteDecorator(node)) return null

    const nameNode = node.childForFieldName('name')
    const className = nameNode?.text ?? 'view'

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Flask class-based view decorators applied wrong',
      `Route decorators on Flask class-based view \`${className}\` should be applied using the \`decorators\` class attribute, not directly to the class.`,
      sourceCode,
      'Use `decorators = [login_required]` class attribute instead of applying decorators to the class.',
    )
  },
}
