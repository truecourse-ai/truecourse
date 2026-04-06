import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const duplicateKeysVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-keys',
  languages: JS_LANGUAGES,
  nodeTypes: ['object'],
  visit(node, filePath, sourceCode) {
    const seen = new Set<string>()
    for (const child of node.namedChildren) {
      if (child.type === 'pair') {
        const key = child.childForFieldName('key')
        if (key) {
          const keyText = key.text
          if (seen.has(keyText)) {
            return makeViolation(
              this.ruleKey, child, filePath, 'high',
              'Duplicate object key',
              `Key \`${keyText}\` is duplicated — the later value silently overwrites the earlier one.`,
              sourceCode,
              'Remove the duplicate key or rename one of them.',
            )
          }
          seen.add(keyText)
        }
      }
    }
    return null
  },
}
