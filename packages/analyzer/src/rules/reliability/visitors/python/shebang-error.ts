import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonShebangErrorVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/shebang-error',
  languages: ['python'],
  nodeTypes: ['module'],
  visit(node, filePath, sourceCode) {
    // Only check files that look like executable scripts
    if (!filePath.includes('bin/') && !filePath.includes('scripts/')) return null
    if (filePath.includes('__init__')) return null

    // Check for main guard — indicator of executable script
    if (!sourceCode.includes('__main__')) return null

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
