import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES, READ_ONLY_GLOBALS } from './_helpers.js'

export const globalReassignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/global-reassignment',
  languages: JS_LANGUAGES,
  nodeTypes: ['assignment_expression', 'augmented_assignment_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    if (!left) return null
    // tree-sitter may parse `undefined` as type 'undefined' (keyword-like) or 'identifier'
    if (left.type !== 'identifier' && left.type !== 'undefined') return null

    if (READ_ONLY_GLOBALS.has(left.text)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Global reassignment',
        `\`${left.text}\` is a built-in global and should not be reassigned — this changes its value for all code in the same scope.`,
        sourceCode,
        `Use a different variable name instead of reassigning \`${left.text}\`.`,
      )
    }
    return null
  },
}
