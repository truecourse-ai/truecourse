import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES, RESTRICTED_NAMES } from './_helpers.js'

export const restrictedNameShadowingVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/restricted-name-shadowing',
  languages: JS_LANGUAGES,
  nodeTypes: ['variable_declarator', 'formal_parameters', 'identifier'],
  visit(node, filePath, sourceCode) {
    // Only check parameter names (formal_parameters children) and variable declarators
    if (node.type === 'identifier') {
      // Must be a parameter in a formal_parameters list
      if (node.parent?.type !== 'formal_parameters' &&
          node.parent?.type !== 'required_parameter' &&
          node.parent?.type !== 'optional_parameter') return null
      if (RESTRICTED_NAMES.has(node.text)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Restricted name shadowing',
          `\`${node.text}\` is a restricted name that should not be used as a parameter — it shadows the built-in \`${node.text}\`.`,
          sourceCode,
          `Rename the parameter to avoid shadowing \`${node.text}\`.`,
        )
      }
    }

    if (node.type === 'variable_declarator') {
      const name = node.childForFieldName('name')
      if (name?.type === 'identifier' && RESTRICTED_NAMES.has(name.text)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Restricted name shadowing',
          `\`${name.text}\` is a restricted name that should not be reassigned as a variable — it shadows the built-in \`${name.text}\`.`,
          sourceCode,
          `Rename the variable to avoid shadowing \`${name.text}\`.`,
        )
      }
    }

    return null
  },
}
