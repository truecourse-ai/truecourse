import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Only `switch` STATEMENTS are checked. Two-arm `switch` expressions
 * (`x switch { A => …, _ => … }`) are idiomatic pattern matching and are
 * never flagged.
 */
export const csharpTrivialSwitchVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/trivial-switch',
  languages: ['csharp'],
  nodeTypes: ['switch_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null
    const sections = body.namedChildren.filter((c) => c?.type === 'switch_section')
    if (sections.length > 2) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Trivial switch statement',
      `Switch statement with only ${sections.length} section(s) should be an \`if\` statement for clarity.`,
      sourceCode,
      'Replace the switch with an if/else statement.',
    )
  },
}
