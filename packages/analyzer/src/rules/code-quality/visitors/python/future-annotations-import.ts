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

    // If the file uses PEP 585 lowercase generics (list[...], dict[...], set[...], tuple[...])
    // it already targets Python 3.10+ and doesn't need __future__ annotations
    const pep585Pattern = /(?:->|:)\s*(?:list|dict|set|tuple|frozenset)\s*\[/
    if (pep585Pattern.test(sourceCode)) return null

    // Check if file uses `X | Y` union syntax in annotations (PEP 604 syntax)
    // This requires Python 3.10+ or __future__ annotations on older versions
    // Look for `|` in type annotation contexts — this is a rough heuristic
    // We detect `-> X | Y` or `: X | Y` patterns
    const pep604Pattern = /(?:->|:)\s*\w[\w\[\], ]*\s*\|\s*\w/
    if (!pep604Pattern.test(sourceCode)) return null

    // If the file also uses PEP 585 lowercase generics alongside the | syntax,
    // it's already a 3.10+ file — no need for __future__ annotations
    // (This catches cases like `def foo(x: list[int] | None) -> dict[str, int]:`)
    const hasPep585Anywhere = /\b(?:list|dict|set|tuple|frozenset)\s*\[/.test(sourceCode)
    if (hasPep585Anywhere) return null

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
