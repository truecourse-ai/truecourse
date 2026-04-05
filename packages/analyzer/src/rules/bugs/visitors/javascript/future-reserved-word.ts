import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Future reserved words that shouldn't be used as identifiers
const FUTURE_RESERVED_WORDS = new Set([
  'implements', 'interface', 'package', 'private', 'protected',
  'public', 'static', 'enum',
])

export const futureReservedWordVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/future-reserved-word',
  languages: JS_LANGUAGES,
  nodeTypes: ['variable_declarator', 'function_declaration', 'class_declaration'],
  visit(node, filePath, sourceCode) {
    const nameNode = node.childForFieldName('name')
    if (!nameNode) return null
    const name = nameNode.text

    if (FUTURE_RESERVED_WORDS.has(name)) {
      return makeViolation(
        this.ruleKey, nameNode, filePath, 'medium',
        'Future reserved word used as identifier',
        `\`${name}\` is a future reserved word and should not be used as an identifier — it may break in strict mode or future language versions.`,
        sourceCode,
        `Rename the identifier to avoid using the reserved word \`${name}\`.`,
      )
    }
    return null
  },
}
