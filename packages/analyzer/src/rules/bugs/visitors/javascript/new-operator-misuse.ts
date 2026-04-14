import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES, NON_CONSTRUCTORS } from './_helpers.js'

export const newOperatorMisuseVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/new-operator-misuse',
  languages: JS_LANGUAGES,
  nodeTypes: ['new_expression'],
  visit(node, filePath, sourceCode) {
    const constructor = node.childForFieldName('constructor')
    if (!constructor) return null

    const name = constructor.text
    if (NON_CONSTRUCTORS.has(name)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'new with non-constructor',
        `\`new ${name}()\` throws a TypeError — \`${name}\` cannot be used as a constructor.`,
        sourceCode,
        `Remove \`new\` and call \`${name}()\` directly as a function.`,
      )
    }

    return null
  },
}
