import type { CodeRuleVisitor } from '../../../types.js'
import type { DataFlowContext } from '../../../../data-flow/types.js'
import { makeViolation } from '../../../types.js'
import { findUserInputAccess } from '../../../_shared/javascript-helpers.js'

const TEMPLATE_ENGINE_METHODS = new Set(['render', 'compile', 'template', 'renderString', 'renderFile'])

export const dynamicallyConstructedTemplateVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/dynamically-constructed-template',
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
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    if (!TEMPLATE_ENGINE_METHODS.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // Flag if the first arg is a template literal with user-input substitution
    if (firstArg.type === 'template_string') {
      const hasSubstitution = firstArg.namedChildren.some((c) => c.type === 'template_substitution')
      // Real AST + scope-aware user input detection (see _shared/javascript-helpers.ts).
      // Walks all template substitutions to find user input references.
      if (hasSubstitution && findUserInputAccess(firstArg, dataFlow)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Dynamically constructed template',
          `${methodName}() called with a template string containing user-controlled input. This may enable Server-Side Template Injection (SSTI).`,
          sourceCode,
          'Never construct template strings from user input. Pass user data as template variables instead.',
        )
      }
    }

    // Flag if the first arg is a binary_expression (concatenation) referencing user input
    if (firstArg.type === 'binary_expression' && findUserInputAccess(firstArg, dataFlow)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Dynamically constructed template',
        `${methodName}() called with a concatenated string containing user-controlled input. This may enable SSTI.`,
        sourceCode,
        'Never construct template strings from user input. Pass user data as template variables instead.',
      )
    }

    return null
  },
}
