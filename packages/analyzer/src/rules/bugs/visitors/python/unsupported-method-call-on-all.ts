import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detects: __all__.append(...), __all__.extend(...), __all__ += [...] etc.
// These operations may not work correctly at runtime since __all__ is expected to be a static list
const UNSUPPORTED_METHODS = new Set(['append', 'extend', 'insert', 'remove', 'pop', 'clear', 'sort', 'reverse'])

export const pythonUnsupportedMethodCallOnAllVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unsupported-method-call-on-all',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func || func.type !== 'attribute') return null

    const obj = func.childForFieldName('object')
    if (!obj || obj.text !== '__all__') return null

    const attr = func.childForFieldName('attribute')
    if (!attr) return null

    const methodName = attr.text
    if (!UNSUPPORTED_METHODS.has(methodName)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unsupported method call on __all__',
      `Calling \`__all__.${methodName}()\` — modifying \`__all__\` dynamically may not work correctly at runtime. Use a static list assignment instead.`,
      sourceCode,
      'Define __all__ as a static list: `__all__ = [...]` rather than mutating it dynamically.',
    )
  },
}
