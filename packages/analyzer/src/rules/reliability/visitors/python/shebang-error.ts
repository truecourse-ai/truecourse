import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isScriptLikeFile } from '../../../_shared/python-helpers.js'

export const pythonShebangErrorVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/shebang-error',
  languages: ['python'],
  nodeTypes: ['module'],
  visit(node, filePath, sourceCode) {
    // Only check files that are clearly meant to be directly executed:
    // 1. __main__.py files, OR
    // 2. files with a `if __name__ == "__main__":` guard
    // Don't fire just because a file is in scripts/ or bin/ — it could be a helper module.
    if (filePath.endsWith('__init__.py')) return null
    const segments = filePath.split('/')
    const fileName = segments[segments.length - 1] ?? ''
    const isMainFile = fileName === '__main__.py'
    // Check for __main__ guard using the shared helper's AST check
    const hasMainGuard = !isMainFile && (() => {
      const module = node.type === 'module' ? node : null
      if (!module) return false
      for (const child of module.namedChildren) {
        if (child.type === 'if_statement') {
          const cond = child.childForFieldName('condition')
          if (cond?.text.includes('__name__') && cond?.text.includes('__main__')) return true
        }
      }
      return false
    })()
    if (!isMainFile && !hasMainGuard) return null

    const firstLine = sourceCode.split('\n')[0]
    if (!firstLine) return null

    // Check for shebang
    if (!firstLine.startsWith('#!')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Missing shebang in executable script',
        'Script in bin/ or scripts/ directory with __main__ guard but no shebang line.',
        sourceCode,
        'Add #!/usr/bin/env python3 as the first line.',
      )
    }

    // Check for malformed shebang
    if (!firstLine.includes('python')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Malformed shebang',
        `Shebang line '${firstLine}' does not reference python.`,
        sourceCode,
        'Use #!/usr/bin/env python3 for portable shebang.',
      )
    }

    return null
  },
}
