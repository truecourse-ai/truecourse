import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonDuplicateImportVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-import',
  languages: ['python'],
  nodeTypes: ['module'],
  visit(node, filePath, sourceCode) {
    const seenModules = new Set<string>()

    for (const child of node.namedChildren) {
      if (child.type === 'import_statement') {
        for (const importedName of child.namedChildren) {
          const name = importedName.type === 'dotted_name' ? importedName.text
            : importedName.type === 'aliased_import' ? importedName.childForFieldName('name')?.text ?? null
            : null
          if (name) {
            if (seenModules.has(name)) {
              return makeViolation(
                this.ruleKey, child, filePath, 'medium',
                'Duplicate import',
                `\`import ${name}\` is already imported earlier — the later import shadows the earlier one.`,
                sourceCode,
                'Remove the duplicate import.',
              )
            }
            seenModules.add(name)
          }
        }
      }
    }

    return null
  },
}
