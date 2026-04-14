import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonHashableSetDictMemberVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/hashable-set-dict-member',
  languages: ['python'],
  nodeTypes: ['dictionary', 'set'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'dictionary') {
      for (const child of node.namedChildren) {
        if (child.type === 'pair') {
          const key = child.childForFieldName('key')
          if (key && (key.type === 'list' || key.type === 'dictionary' || key.type === 'set')) {
            return makeViolation(
              this.ruleKey, key, filePath, 'high',
              'Unhashable type as dict key',
              `Using a \`${key.type}\` as a dict key will raise a TypeError — only hashable (immutable) types can be dict keys.`,
              sourceCode,
              'Use a tuple instead of a list/set/dict as the dict key.',
            )
          }
        }
      }
    }

    if (node.type === 'set') {
      for (const child of node.namedChildren) {
        if (child.type === 'list' || child.type === 'dictionary' || child.type === 'set') {
          return makeViolation(
            this.ruleKey, child, filePath, 'high',
            'Unhashable type in set',
            `Using a \`${child.type}\` as a set member will raise a TypeError — set members must be hashable.`,
            sourceCode,
            'Use a tuple instead of a list/set/dict as the set member.',
          )
        }
      }
    }

    return null
  },
}
