import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonDecoratorName, getPythonDecoratorFullName } from '../../../_shared/python-helpers.js'

// Detect: Flask class-based view (MethodView/View subclass) with route decorators
// applied directly to the class instead of using the `decorators` class attribute

function extendsFlaskView(classNode: SyntaxNode): boolean {
  const args = classNode.childForFieldName('superclasses')
  if (!args) return false
  const FLASK_VIEW_BASES = new Set(['MethodView', 'View', 'FlaskView'])
  for (const child of args.namedChildren) {
    // Handle `identifier` (View), `attribute` (flask.views.MethodView), `subscript` (View[T])
    if (child.type === 'identifier' && FLASK_VIEW_BASES.has(child.text)) return true
    if (child.type === 'attribute') {
      const attr = child.childForFieldName('attribute')
      if (attr && FLASK_VIEW_BASES.has(attr.text)) return true
    }
    if (child.type === 'subscript') {
      const value = child.childForFieldName('value')
      if (value?.type === 'identifier' && FLASK_VIEW_BASES.has(value.text)) return true
      if (value?.type === 'attribute') {
        const attr = value.childForFieldName('attribute')
        if (attr && FLASK_VIEW_BASES.has(attr.text)) return true
      }
    }
  }
  return false
}

function hasDirectRouteDecorator(classNode: SyntaxNode): boolean {
  let current: SyntaxNode | null = classNode.parent
  if (!current || current.type !== 'decorated_definition') return false

  for (const child of current.namedChildren) {
    if (child.type !== 'decorator') continue
    const termName = getPythonDecoratorName(child)
    const fullName = getPythonDecoratorFullName(child)
    if (termName === 'route') return true
    // Match decorators like @app.route, @bp.route, @app.get, etc.
    if (fullName && /^(app|bp|blueprint)\.\w+$/.test(fullName)) return true
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
