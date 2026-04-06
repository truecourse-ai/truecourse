import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * FA102: Detects type annotations that require `from __future__ import annotations`
 * to work on older Python versions.
 *
 * Specifically detects `X | Y` union syntax in function annotations without
 * `from __future__ import annotations` in the file.
 */
export const pythonFutureAnnotationsImportVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/future-annotations-import',
  languages: ['python'],
  nodeTypes: ['module'],
  visit(node, filePath, sourceCode) {
    // Check if file already has `from __future__ import annotations`
    const hasFutureAnnotations = sourceCode.includes('from __future__ import annotations')
    if (hasFutureAnnotations) return null

    // Check if file uses `X | Y` union syntax in annotations (PEP 604 syntax)
    // This requires Python 3.10+ or __future__ annotations on older versions
    // Look for `|` in type annotation contexts — this is a rough heuristic
    // We detect `-> X | Y` or `: X | Y` patterns
    const pep604Pattern = /(?:->|:)\s*\w[\w\[\], ]*\s*\|\s*\w/
    if (!pep604Pattern.test(sourceCode)) return null

    // Check if there are any function definitions with union syntax annotations
    for (const child of node.namedChildren) {
      if (child.type === 'function_definition') {
        const returnType = child.childForFieldName('return_type')
        if (returnType && returnType.text.includes('|')) {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Future annotations import needed',
            '`X | Y` union syntax in annotations requires Python 3.10+ or `from __future__ import annotations` for older versions.',
            sourceCode,
            'Add `from __future__ import annotations` at the top of the file to support this syntax on Python < 3.10.',
          )
        }
      }
    }

    return null
  },
}
