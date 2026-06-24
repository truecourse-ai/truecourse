import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A `default:` section whose only statement is `break` adds no behaviour over
 * having no default at all — both fall through to the code after the switch. It
 * is dead scaffolding that should be removed for clarity. The check requires a
 * section labelled only `default` (no stacked `case` labels) whose single
 * statement is a bare `break`.
 */
export const csharpRedundantDefaultSwitchSectionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-default-switch-section',
  languages: ['csharp'],
  nodeTypes: ['switch_section'],
  visit(node, filePath, sourceCode) {
    const hasDefaultLabel = node.children.some((c) => c?.type === 'default')
    if (!hasDefaultLabel) return null

    // A section sharing a `case` label with `default` (stacked labels) carries
    // real behaviour and must not be flagged.
    const hasCaseLabel = node.children.some(
      (c) => c?.type === 'case_switch_label' || c?.type === 'constant_pattern' || c?.type === 'case_pattern_switch_label',
    )
    if (hasCaseLabel) return null

    const statements = node.namedChildren.filter(
      (c) => c?.type !== 'constant_pattern' && c?.type !== 'case_pattern_switch_label',
    )
    if (statements.length !== 1 || statements[0]?.type !== 'break_statement') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Redundant default switch section',
      'A `default` section whose only statement is `break` adds nothing over having no default at all.',
      sourceCode,
      'Remove the redundant `default` section.',
    )
  },
}
