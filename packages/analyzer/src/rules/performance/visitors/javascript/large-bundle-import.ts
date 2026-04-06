import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { LARGE_PACKAGES } from './_helpers.js'

export const largeBundleImportVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/large-bundle-import',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['import_statement'],
  visit(node, filePath, sourceCode) {
    const source = node.childForFieldName('source')
    if (!source) return null

    const moduleName = source.text.replace(/['"]/g, '')

    if (!LARGE_PACKAGES.has(moduleName)) return null

    // Check if it's a default or namespace import (not a named import of specific items)
    // import _ from 'lodash'  → import_clause with identifier
    // import * as _ from 'lodash' → import_clause with namespace_import
    // import { get } from 'lodash' → this is also bad for lodash, but less clear-cut
    // We flag default and namespace imports of these packages
    const importClause = node.namedChildren.find(
      (c) => c.type === 'import_clause',
    )
    if (!importClause) return null

    const hasDefault = importClause.namedChildren.some((c) => c.type === 'identifier')
    const hasNamespace = importClause.namedChildren.some((c) => c.type === 'namespace_import')

    if (hasDefault || hasNamespace) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Large bundle import',
        `Importing the entirety of '${moduleName}' increases bundle size. Use a subpath import instead (e.g., '${moduleName}/get').`,
        sourceCode,
        `Use subpath imports (e.g., import get from '${moduleName}/get') to reduce bundle size.`,
      )
    }

    return null
  },
}
