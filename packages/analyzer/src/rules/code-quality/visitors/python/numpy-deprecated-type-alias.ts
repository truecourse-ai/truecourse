import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Deprecated NumPy type aliases removed in NumPy 2.0
const DEPRECATED_NP_TYPES = new Set([
  'bool', 'int', 'float', 'complex', 'object', 'str', 'long', 'unicode',
  'int0', 'uint0', 'bool8', 'string_',
])

export const pythonNumpyDeprecatedTypeAliasVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/numpy-deprecated-type-alias',
  languages: ['python'],
  nodeTypes: ['attribute'],
  visit(node, filePath, sourceCode) {
    const obj = node.childForFieldName('object')
    const attr = node.childForFieldName('attribute')
    if (!obj || !attr) return null

    const objText = obj.text
    if (objText !== 'np' && objText !== 'numpy') return null

    if (DEPRECATED_NP_TYPES.has(attr.text)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Deprecated NumPy type alias',
        `\`${objText}.${attr.text}\` is a deprecated NumPy type alias removed in NumPy 2.0. Use the built-in Python type or a specific NumPy dtype instead.`,
        sourceCode,
        `Replace \`${objText}.${attr.text}\` with the built-in \`${attr.text}\` or a specific NumPy dtype like \`np.float64\`.`,
      )
    }

    return null
  },
}
