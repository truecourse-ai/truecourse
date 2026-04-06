import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Statement types that are valid targets for labels
const VALID_LABEL_TARGETS = new Set([
  'for_statement', 'for_in_statement', 'for_of_statement',
  'while_statement', 'do_statement', 'switch_statement',
])

export const labelOnNonLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/label-on-non-loop',
  languages: JS_LANGUAGES,
  nodeTypes: ['labeled_statement'],
  visit(node, filePath, sourceCode) {
    // The body of a labeled_statement is the second named child (after the label identifier)
    const body = node.namedChildren[1]
    if (!body) return null

    if (!VALID_LABEL_TARGETS.has(body.type)) {
      const label = node.namedChildren[0]
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Label on non-loop statement',
        `The label \`${label?.text ?? ''}\` is applied to a \`${body.type.replace(/_/g, ' ')}\` — labels should only be used on loops or switch statements.`,
        sourceCode,
        'Remove the label or restructure the code to use it on a loop/switch statement.',
      )
    }
    return null
  },
}
