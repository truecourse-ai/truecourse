import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const sortingStyleVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/sorting-style',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['import_statement'],
  visit(node, filePath, sourceCode) {
    // Check named imports: import { z, a, m } from '...'
    const importClause = node.namedChildren.find((c) => c.type === 'import_clause')
    if (!importClause) return null

    const namedImports = importClause.namedChildren.find((c) => c.type === 'named_imports')
    if (!namedImports) return null

    const specifiers = namedImports.namedChildren.filter((c) => c.type === 'import_specifier')
    if (specifiers.length < 2) return null

    const names = specifiers.map((s) => {
      const name = s.childForFieldName('name')
      return name?.text ?? s.text
    })

    const sorted = [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    if (names.join(',') !== sorted.join(',')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unsorted named imports',
        'Named imports are not sorted alphabetically.',
        sourceCode,
        `Sort imports: { ${sorted.join(', ')} }`,
      )
    }

    return null
  },
}
