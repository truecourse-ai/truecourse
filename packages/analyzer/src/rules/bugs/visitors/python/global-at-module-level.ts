import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects `global` statements at module level — they have no effect there.
 */
export const pythonGlobalAtModuleLevelVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/global-at-module-level',
  languages: ['python'],
  nodeTypes: ['global_statement'],
  visit(node, filePath, sourceCode) {
    // Check if the parent is the module (top-level)
    let parent = node.parent
    if (!parent) return null

    if (parent.type === 'module') {
      const names = node.namedChildren
        .filter((c) => c.type === 'identifier')
        .map((c) => c.text)
        .join(', ')

      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Global statement at module level',
        `\`global ${names}\` at module level has no effect — variables are already global at the top level.`,
        sourceCode,
        `Remove the \`global\` statement — it is redundant at module level.`,
      )
    }

    return null
  },
}
