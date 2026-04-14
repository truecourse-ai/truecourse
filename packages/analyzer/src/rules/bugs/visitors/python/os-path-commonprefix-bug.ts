import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detects: os.path.commonprefix(...) — does character-level comparison, not path-level
// Should use os.path.commonpath() instead
export const pythonOsPathCommonprefixBugVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/os-path-commonprefix-bug',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func) return null

    // Match os.path.commonprefix(...)
    if (func.type === 'attribute') {
      const attr = func.childForFieldName('attribute')
      if (attr?.text !== 'commonprefix') return null

      const obj = func.childForFieldName('object')
      if (!obj) return null

      // Check for os.path
      if (obj.type === 'attribute') {
        const objAttr = obj.childForFieldName('attribute')
        const objObj = obj.childForFieldName('object')
        if (objObj?.text === 'os' && objAttr?.text === 'path') {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'os.path.commonprefix does character-level comparison',
            '`os.path.commonprefix()` does character-level string comparison, not path-level — use `os.path.commonpath()` for path-aware common prefix.',
            sourceCode,
            'Replace `os.path.commonprefix()` with `os.path.commonpath()` for correct path-level comparison.',
          )
        }
      }
    }

    return null
  },
}
