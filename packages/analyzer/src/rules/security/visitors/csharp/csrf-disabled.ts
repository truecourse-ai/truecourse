import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCreatedTypeName } from './_helpers.js'

/**
 * Antiforgery (CSRF) protection explicitly disabled:
 * `[IgnoreAntiforgeryToken]` on an action/controller, or registering
 * `IgnoreAntiforgeryTokenAttribute` as a global filter.
 */
export const csharpCsrfDisabledVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/csrf-disabled',
  languages: ['csharp'],
  nodeTypes: ['attribute', 'object_creation_expression'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'attribute') {
      const name = node.childForFieldName('name')?.text ?? ''
      const simple = (name.split('.').pop() ?? name).replace(/Attribute$/, '')
      if (simple !== 'IgnoreAntiforgeryToken') return null
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'CSRF protection disabled',
        '[IgnoreAntiforgeryToken] disables antiforgery validation, allowing cross-site request forgery.',
        sourceCode,
        'Remove the attribute, or use [ValidateAntiForgeryToken] and send the token from the client.',
      )
    }

    if (getCreatedTypeName(node) !== 'IgnoreAntiforgeryTokenAttribute') return null
    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'CSRF protection disabled',
      'Registering IgnoreAntiforgeryTokenAttribute disables antiforgery validation globally.',
      sourceCode,
      'Use AutoValidateAntiforgeryTokenAttribute instead so state-changing requests are protected.',
    )
  },
}
