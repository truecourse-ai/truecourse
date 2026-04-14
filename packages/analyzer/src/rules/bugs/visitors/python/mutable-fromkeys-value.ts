import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonMutableFromkeysValueVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/mutable-fromkeys-value',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const attr = fn.childForFieldName('attribute')
    if (!attr || attr.text !== 'fromkeys') return null

    // Could be dict.fromkeys(...) or MyClass.fromkeys(...)
    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argNodes = args.namedChildren
    if (argNodes.length < 2) return null

    const defaultValue = argNodes[1]
    // Mutable defaults: list, dict, set literals
    if (defaultValue.type === 'list' || defaultValue.type === 'dictionary' || defaultValue.type === 'set') {
      return makeViolation(
        this.ruleKey, defaultValue, filePath, 'high',
        'Mutable value in dict.fromkeys',
        `\`dict.fromkeys(keys, ${defaultValue.text})\` — all keys share the same mutable ${defaultValue.type} instance. Mutating the value for one key affects all keys.`,
        sourceCode,
        `Use a dict comprehension instead: \`{k: ${defaultValue.type === 'list' ? '[]' : defaultValue.type === 'set' ? 'set()' : '{}'} for k in keys}\`.`,
      )
    }
    return null
  },
}
