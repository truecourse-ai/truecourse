import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

function shouldSkipFile(filePath: string, sourceCode: string): boolean {
  const lowerPath = filePath.toLowerCase()

  // Path-based skips: contexts where console.log is idiomatic / expected
  if (
    lowerPath.includes('/scripts/') ||
    lowerPath.includes('/script/') ||
    lowerPath.includes('/examples/') ||
    lowerPath.includes('/example/') ||
    lowerPath.includes('/seeds/') ||
    lowerPath.includes('/seed/') ||
    lowerPath.includes('/bin/') ||
    lowerPath.includes('/cli/') ||
    lowerPath.includes('/logs/') ||
    lowerPath.includes('/dev-') ||
    lowerPath.endsWith('.script.ts') ||
    lowerPath.endsWith('.script.js') ||
    lowerPath.endsWith('.dev.ts') ||
    lowerPath.endsWith('.dev.js') ||
    /\.(test|spec|e2e)\.[jt]sx?$/.test(lowerPath)
  ) {
    return true
  }

  // Heuristic: files with multiple top-level `declare` statements are synthetic
  // type-only snippets (positive-fixture style), not production source. Skip.
  const declareMatches = sourceCode.match(/^declare\s+(const|let|var|function|class|interface|type|namespace|module|enum)\b/gm)
  if (declareMatches && declareMatches.length >= 2) {
    return true
  }

  // Heuristic: short standalone files with no imports and few exports are
  // typically auxiliary snippets / fixture helpers, not production modules
  // where a stray console.log would actually matter. Require at least one of:
  //   - an `import` statement (real module wiring)
  //   - more than 5 exports (substantial public surface)
  //   - more than 22 non-blank lines (substantial body)
  const hasImport = /^\s*import\s+/m.test(sourceCode)
  if (!hasImport) {
    const exportCount = (sourceCode.match(/^\s*export\s+/gm) ?? []).length
    if (exportCount <= 5) {
      const nonBlankLines = sourceCode.split('\n').filter((l) => l.trim().length > 0).length
      if (nonBlankLines <= 22) {
        return true
      }
    }
  }

  return false
}

export const consoleLogVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/console-log',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null
    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')
    if (!obj || !prop) return null
    if (obj.text !== 'console') return null
    if (prop.text !== 'log' && prop.text !== 'debug') return null

    if (shouldSkipFile(filePath, sourceCode)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `console.${prop.text} call`,
      `console.${prop.text} should be removed or replaced with a proper logger in production code.`,
      sourceCode,
      'Replace console.log/debug with a structured logger or remove it.',
    )
  },
}
