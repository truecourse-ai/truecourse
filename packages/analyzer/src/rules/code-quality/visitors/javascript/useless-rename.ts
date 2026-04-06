import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const uselessRenameVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-rename',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['object_pattern', 'object'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'object_pattern') {
      for (const child of node.namedChildren) {
        if (child.type === 'pair_pattern') {
          const key = child.childForFieldName('key')
          const value = child.childForFieldName('value')
          if (key?.type === 'property_identifier' && value?.type === 'identifier'
            && key.text === value.text) {
            return makeViolation(
              this.ruleKey, child, filePath, 'low',
              'Useless destructuring rename',
              `\`{ ${key.text}: ${value.text} }\` renames to the same name — use \`{ ${key.text} }\` instead.`,
              sourceCode,
              `Replace \`{ ${key.text}: ${key.text} }\` with \`{ ${key.text} }\`.`,
            )
          }
        }
      }
    }
    return null
  },
}
