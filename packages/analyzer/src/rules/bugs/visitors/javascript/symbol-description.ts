import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const symbolDescriptionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/symbol-description',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.text !== 'Symbol') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Symbol() with no args or Symbol(undefined) — no description
    const argChildren = args.namedChildren
    if (argChildren.length === 0) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Symbol without description',
        '`Symbol()` called without a description string makes debugging harder.',
        sourceCode,
        'Add a description string: `Symbol("mySymbol")`.',
      )
    }

    // Symbol(undefined) is also no description
    if (argChildren.length === 1 && (argChildren[0].type === 'undefined' || (argChildren[0].type === 'identifier' && argChildren[0].text === 'undefined'))) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Symbol without description',
        '`Symbol(undefined)` has no description — use a string description for easier debugging.',
        sourceCode,
        'Add a description string: `Symbol("mySymbol")`.',
      )
    }

    return null
  },
}
