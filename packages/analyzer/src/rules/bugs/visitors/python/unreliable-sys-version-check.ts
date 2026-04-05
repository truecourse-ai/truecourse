import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detects: sys.version[0] or sys.version[:3] for version comparison
// Breaks for Python 3.10+ where minor version is two digits
export const pythonUnreliableSysVersionCheckVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unreliable-sys-version-check',
  languages: ['python'],
  nodeTypes: ['subscript', 'comparison_operator'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'subscript') {
      // Pattern: sys.version[...] or sys.version[:3] etc.
      const obj = node.childForFieldName('value')
      if (!obj) return null

      if (!isSysVersion(obj)) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unreliable sys.version check',
        '`sys.version` is a string and string slicing/indexing is unreliable for version checks — Python 3.10+ has two-digit minor versions that break these patterns.',
        sourceCode,
        'Use `sys.version_info` tuple for reliable version comparisons: `sys.version_info >= (3, 10)`.',
      )
    }

    if (node.type === 'comparison_operator') {
      // Pattern: sys.version.startswith(...) or sys.version < "3.10"
      const left = node.namedChildren[0]
      if (!left) return null

      // Check for sys.version used directly in comparison
      if (isSysVersion(left)) {
        const right = node.namedChildren[node.namedChildren.length - 1]
        // Only flag if right side is a string literal (version string comparison)
        if (right?.type === 'string') {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Unreliable sys.version check',
            '`sys.version` string comparison is unreliable — use `sys.version_info` tuple comparisons instead.',
            sourceCode,
            'Use `sys.version_info >= (3, 10)` instead of comparing `sys.version` string.',
          )
        }
      }
    }

    return null
  },
}

function isSysVersion(node: import('tree-sitter').SyntaxNode): boolean {
  if (node.type === 'attribute') {
    const obj = node.childForFieldName('object')
    const attr = node.childForFieldName('attribute')
    return obj?.text === 'sys' && attr?.text === 'version'
  }
  return false
}
