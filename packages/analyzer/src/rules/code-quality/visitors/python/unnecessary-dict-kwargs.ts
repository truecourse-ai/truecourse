import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUnnecessaryDictKwargsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-dict-kwargs',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const child of args.namedChildren) {
      // dictionary_splat: **{...}
      if (child.type === 'dictionary_splat') {
        const inner = child.namedChildren[0]
        if (inner && inner.type === 'dictionary') {
          return makeViolation(
            this.ruleKey, child, filePath, 'low',
            'Unnecessary dict unpacking in kwargs',
            '`**{"key": value}` in a function call is unnecessarily verbose. Pass keyword arguments directly.',
            sourceCode,
            'Replace `func(**{"key": value})` with `func(key=value)`.',
          )
        }
      }
    }

    return null
  },
}
