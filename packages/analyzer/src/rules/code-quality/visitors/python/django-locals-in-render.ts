import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

function isLocalsCall(node: SyntaxNode): boolean {
  return node.type === 'call' &&
    node.childForFieldName('function')?.text === 'locals'
}

export const pythonDjangoLocalsInRenderVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/django-locals-in-render',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Match: render(request, template, locals())
    // or: shortcuts.render(...)
    const isRender =
      (fn.type === 'identifier' && fn.text === 'render') ||
      (fn.type === 'attribute' && fn.childForFieldName('attribute')?.text === 'render')

    if (!isRender) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const positionalArgs = args.namedChildren.filter((c) => c.type !== 'keyword_argument')

    // render(request, template_name, context) — context is 3rd positional arg
    if (positionalArgs.length >= 3 && isLocalsCall(positionalArgs[2])) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Django render with locals()',
        'Passing `locals()` to Django\'s `render()` exposes all local variables to the template, including internal variables and potentially sensitive data.',
        sourceCode,
        'Pass an explicit context dictionary instead: `render(request, template, {"key": value})`.',
      )
    }

    // Check keyword argument context=locals()
    for (const child of args.namedChildren) {
      if (child.type === 'keyword_argument') {
        const key = child.childForFieldName('name')
        const value = child.childForFieldName('value')
        if (key?.text === 'context' && value && isLocalsCall(value)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Django render with locals()',
            'Passing `locals()` to Django\'s `render()` exposes all local variables to the template, including internal variables and potentially sensitive data.',
            sourceCode,
            'Pass an explicit context dictionary instead: `render(request, template, context={"key": value})`.',
          )
        }
      }
    }

    return null
  },
}
