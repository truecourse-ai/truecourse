import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonPprintUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/pprint-usage',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // pprint(...)
    if (fn.type === 'identifier' && fn.text === 'pprint') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'pprint() call in production code',
        '`pprint()` is a debug utility — use proper logging or serialization instead.',
        sourceCode,
        'Replace with `logging.debug(json.dumps(data, indent=2))` or similar.',
      )
    }

    // pprint.pprint(...)
    if (fn.type === 'attribute') {
      const obj = fn.childForFieldName('object')
      const attr = fn.childForFieldName('attribute')
      if (obj?.text === 'pprint' && attr?.text === 'pprint') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'pprint.pprint() call in production code',
          '`pprint.pprint()` is a debug utility — use proper logging or serialization instead.',
          sourceCode,
          'Replace with proper logging.',
        )
      }
    }

    return null
  },
}
