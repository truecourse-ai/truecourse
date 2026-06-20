import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** The simple type name of a parameter, ignoring namespace qualification. */
function parameterTypeName(param: SyntaxNode): string {
  const type = param.childForFieldName('type')
  if (!type) return ''
  const text = type.text
  return text.includes('.') ? text.slice(text.lastIndexOf('.') + 1) : text
}

/** True when the parameter has a default value (an `=` initializer). */
function hasDefault(param: SyntaxNode): boolean {
  return param.children.some((c) => c?.type === '=')
}

/** True for `params` / `out`/`ref`/`this`-modified trailing parameters that may legitimately follow. */
function hasParamsModifier(param: SyntaxNode): boolean {
  return param.children.some((c) => c?.type === 'parameter_modifier' && c.text === 'params')
}

/**
 * A `CancellationToken` parameter that is not the last in the list. The
 * convention (and what callers expect) is for the token to come last so it can
 * be optional and consistently positioned. A token followed only by other
 * optional parameters or a `params` array is allowed; a token followed by a
 * required parameter is the clear violation. To avoid noise, this only fires
 * when the token itself has no default and a required parameter follows it.
 */
export const csharpCancellationTokenNotLastVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/cancellation-token-not-last',
  languages: ['csharp'],
  nodeTypes: ['parameter_list'],
  visit(node, filePath, sourceCode) {
    const params = node.namedChildren.filter((c) => c?.type === 'parameter') as SyntaxNode[]
    for (let i = 0; i < params.length - 1; i++) {
      if (parameterTypeName(params[i]!) !== 'CancellationToken') continue
      // Trailing optional/params parameters after the token are acceptable;
      // only a later *required* positional parameter is a real ordering bug.
      const later = params.slice(i + 1)
      const followedByRequired = later.some((p) => !hasDefault(p) && !hasParamsModifier(p))
      if (followedByRequired) {
        return makeViolation(
          this.ruleKey, params[i]!, filePath, 'low',
          'CancellationToken parameter is not last',
          'A CancellationToken parameter precedes a required parameter; by convention it should be the final parameter so callers can position it consistently.',
          sourceCode,
          'Move the CancellationToken parameter to the end of the parameter list.',
        )
      }
    }
    return null
  },
}
