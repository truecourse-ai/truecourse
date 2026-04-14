import type { CodeRuleVisitor } from '../../../types.js'
import type { DataFlowContext } from '../../../../data-flow/types.js'
import { makeViolation } from '../../../types.js'
import { findUserInputAccess } from '../../../_shared/javascript-helpers.js'

export const userInputInRedirectVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/user-input-in-redirect',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  needsDataFlow: true,
  visit(node, filePath, sourceCode, dataFlow?: DataFlowContext) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) methodName = prop.text
    }

    if (methodName !== 'redirect') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Real AST + scope-aware user input detection. See _shared/javascript-helpers.ts.
    // Replaces argText.includes('req.') / 'body' / 'query' / 'returnUrl' style
    // substring matching that flagged unrelated identifiers.
    for (const arg of args.namedChildren) {
      if (findUserInputAccess(arg, dataFlow)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'User input in redirect URL',
          'res.redirect() called with user-controlled URL. This allows open redirect attacks.',
          sourceCode,
          'Validate redirect URLs against an allowlist of trusted domains before redirecting.',
        )
      }
    }

    return null
  },
}
