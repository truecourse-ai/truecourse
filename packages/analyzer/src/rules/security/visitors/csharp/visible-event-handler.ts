import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'
import { lastSegment } from './_helpers.js'

/**
 * A publicly visible event handler — a `public`/`protected` method with the
 * canonical handler signature `void M(object sender, EventArgs e)` (the second
 * parameter being EventArgs or a subclass). Event handlers are callbacks wired
 * to events and should generally not be invokable as part of the public API.
 */
function paramTypes(method: SyntaxNode): string[] {
  const list = method.childForFieldName('parameters') ?? method.namedChildren.find((c) => c?.type === 'parameter_list')
  if (!list) return []
  const out: string[] = []
  for (const param of list.namedChildren) {
    if (param?.type !== 'parameter') continue
    const typeNode = param.childForFieldName('type')
    out.push(typeNode ? lastSegment(typeNode.text) : '')
  }
  return out
}

export const csharpVisibleEventHandlerVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/visible-event-handler',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    if (!hasCSharpModifier(node, 'public') && !hasCSharpModifier(node, 'protected')) return null

    const returnType = node.childForFieldName('returns')
    if (returnType?.text !== 'void') return null

    const types = paramTypes(node)
    if (types.length !== 2) return null
    if (types[0] !== 'object') return null
    if (!/EventArgs$/.test(types[1] ?? '')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Publicly visible event handler',
      'This event-handler method is public/protected, exposing a callback that should generally stay non-public.',
      sourceCode,
      'Make the event handler private; subscribe to the event from within the class.',
    )
  },
}
