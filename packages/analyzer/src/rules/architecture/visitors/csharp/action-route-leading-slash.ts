import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { HTTP_VERB_ATTRIBUTES } from './_controller-helpers.js'

/**
 * An action-level route template starting with `/` is treated as an absolute
 * route: it escapes the controller's `[Route]` prefix, so the action lands at
 * an unexpected URL. `~/` (explicit override) is intentional and excluded.
 *
 * Matched at the attribute level so it fires for [Route("/x")] and the route
 * argument of [HttpGet("/x")] alike, on actions only (the controller-level
 * [Route] is allowed to be absolute).
 */
function leadingSlashTemplate(attr: SyntaxNode): SyntaxNode | null {
  const name = attr.childForFieldName('name')?.text?.split('.').pop() ?? ''
  if (name !== 'Route' && !HTTP_VERB_ATTRIBUTES.has(name)) return null

  const argList = attr.namedChildren.find((c) => c?.type === 'attribute_argument_list')
  const firstArg = argList?.namedChildren.find((c) => c?.type === 'attribute_argument')
  const literal = firstArg?.namedChildren.find((c) => c?.type === 'string_literal')
  if (!literal) return null
  const content = literal.namedChildren.find((c) => c?.type === 'string_literal_content')
  const text = content?.text ?? ''
  if (text.startsWith('/') && !text.startsWith('//')) return literal
  return null
}

/** True when the attribute sits on a method (an action), not on the class. */
function isOnMethod(attr: SyntaxNode): boolean {
  return attr.parent?.parent?.type === 'method_declaration'
}

export const csharpActionRouteLeadingSlashVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/action-route-leading-slash',
  languages: ['csharp'],
  nodeTypes: ['attribute'],
  visit(node, filePath, sourceCode) {
    if (!isOnMethod(node)) return null
    const literal = leadingSlashTemplate(node)
    if (!literal) return null

    return makeViolation(
      this.ruleKey, literal, filePath, 'low',
      'Action route starts with a slash',
      'A leading slash makes this an absolute route, escaping the controller route prefix unexpectedly.',
      sourceCode,
      'Drop the leading slash so the template is relative to the controller route, or use ~/ to override deliberately.',
    )
  },
}
