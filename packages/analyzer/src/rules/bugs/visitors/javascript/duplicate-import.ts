import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const duplicateImportVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-import',
  languages: JS_LANGUAGES,
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    const seenSources = new Set<string>()

    for (const child of node.namedChildren) {
      if (child.type === 'import_statement') {
        const source = child.namedChildren.find((c) => c.type === 'string')
        if (source) {
          const src = source.text
          if (seenSources.has(src)) {
            return makeViolation(
              this.ruleKey, child, filePath, 'medium',
              'Duplicate import',
              `Module ${src} is imported more than once — consolidate into a single import statement.`,
              sourceCode,
              'Merge the duplicate imports into a single import statement.',
            )
          }
          seenSources.add(src)
        }
      }
    }

    return null
  },
}
