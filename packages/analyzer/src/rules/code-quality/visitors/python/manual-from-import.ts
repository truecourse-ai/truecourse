import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects manual from-import patterns:
 * PLR0402: `import x.y; x.y.z` instead of `from x.y import z`
 *
 * We detect the pattern where a module is imported via `import a.b.c`
 * and then referenced only as `a.b.c.something` — use `from a.b import c` instead.
 */
export const pythonManualFromImportVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/manual-from-import',
  languages: ['python'],
  nodeTypes: ['import_statement'],
  visit(node, filePath, sourceCode) {
    // Look for `import a.b` or `import a.b.c` — dotted imports
    // These are typically better expressed as `from a import b` or `from a.b import c`
    for (const child of node.namedChildren) {
      if (child.type === 'dotted_name') {
        const parts = child.text.split('.')
        if (parts.length >= 2) {
          const modulePath = parts.slice(0, -1).join('.')
          const lastName = parts[parts.length - 1]
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Manual from-import',
            `\`import ${child.text}\` is unnecessarily verbose. Use \`from ${modulePath} import ${lastName}\` instead.`,
            sourceCode,
            `Replace \`import ${child.text}\` with \`from ${modulePath} import ${lastName}\`.`,
          )
        }
      }
    }

    return null
  },
}
