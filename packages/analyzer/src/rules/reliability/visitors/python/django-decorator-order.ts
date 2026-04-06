import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonDjangoDecoratorOrderVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/django-decorator-order',
  languages: ['python'],
  nodeTypes: ['decorated_definition'],
  visit(node, filePath, sourceCode) {
    const decorators = node.namedChildren.filter((c) => c.type === 'decorator')
    if (decorators.length < 2) return null

    // Extract decorator names in order (top to bottom)
    const decNames: string[] = []
    for (const dec of decorators) {
      const text = dec.text.replace('@', '').split('(')[0].trim()
      decNames.push(text)
    }

    // Django rules: @login_required should be BELOW (applied first) @require_http_methods
    // Decorators are applied bottom-up, so the bottom decorator runs first
    const loginIdx = decNames.indexOf('login_required')
    const requireIdx = decNames.findIndex((n) =>
      n === 'require_http_methods' || n === 'require_GET' || n === 'require_POST',
    )

    if (loginIdx >= 0 && requireIdx >= 0 && loginIdx < requireIdx) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Wrong Django decorator order',
        '@login_required should be below @require_http_methods. Decorators are applied bottom-up: auth check should run before method check.',
        sourceCode,
        'Move @login_required below @require_http_methods.',
      )
    }

    return null
  },
}
