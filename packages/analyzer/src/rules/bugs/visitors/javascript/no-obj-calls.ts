import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES, NON_CALLABLE_GLOBALS } from './_helpers.js'

export const noObjCallsVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/no-obj-calls',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier') return null

    if (NON_CALLABLE_GLOBALS.has(fn.text)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Global object called as function',
        `\`${fn.text}()\` is not a function — calling it always throws a TypeError.`,
        sourceCode,
        `Remove the \`()\` call. \`${fn.text}\` is a namespace object, not a constructor.`,
      )
    }
    return null
  },
}
