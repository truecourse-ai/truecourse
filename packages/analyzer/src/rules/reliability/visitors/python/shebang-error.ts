import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isScriptLikeFile } from '../../../_shared/python-helpers.js'

export const pythonShebangErrorVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/shebang-error',
  languages: ['python'],
  nodeTypes: ['module'],
  visit(node, filePath, sourceCode) {
    if (filePath.endsWith('__init__.py')) return null
    const segments = filePath.split('/')
    const fileName = segments[segments.length - 1] ?? ''

    // `__main__.py` is the canonical entry for `python -m package`,
    // which does NOT use the shebang. Only `./script.py`-style direct
    // execution does. Skip __main__.py entirely.
    if (fileName === '__main__.py') return null

    // The shebang only matters for files invoked AS executables
    // (`./file.py`). That requires both a shebang AND the executable
    // bit — and is conventionally restricted to `bin/`-shaped
    // directories. A file with `if __name__ == "__main__":` alone is
    // most often a module that's ALSO runnable via `python -m` or
    // `pytest`, neither of which need a shebang.
    //
    // Restrict firing to files whose path segment is `bin/`, `bins/`,
    // or `cli/` — the canonical executable-script locations.
    const isExecutablePath = /(?:^|\/)(?:bin|bins|cli)\//.test(filePath)
    if (!isExecutablePath) return null

    // Check for __main__ guard using the shared helper's AST check
    const hasMainGuard = (() => {
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
    if (!hasMainGuard) return null

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
