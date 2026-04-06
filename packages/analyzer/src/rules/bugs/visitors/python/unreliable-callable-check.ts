import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUnreliableCallableCheckVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unreliable-callable-check',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.text !== 'hasattr') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argNodes = args.namedChildren
    if (argNodes.length < 2) return null

    const secondArg = argNodes[1]
    // Look for hasattr(x, '__call__')
    if (secondArg?.type === 'string' && secondArg.text.replace(/['"]/g, '') === '__call__') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Unreliable callable check',
        '`hasattr(x, "__call__")` is unreliable — it can miss many edge cases. Use `callable(x)` instead.',
        sourceCode,
        'Replace `hasattr(x, "__call__")` with `callable(x)`.',
      )
    }
    return null
  },
}
