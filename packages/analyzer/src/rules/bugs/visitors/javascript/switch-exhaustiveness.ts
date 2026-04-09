import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Switch statement on a union/enum type that does not cover all possible values.
 * Corresponds to @typescript-eslint/switch-exhaustiveness-check.
 *
 * Heuristic: if the switch discriminant is a union type and there is no default clause,
 * check whether the number of case clauses covers all union members.
 */
export const switchExhaustivenessVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/switch-exhaustiveness',
  languages: TS_LANGUAGES,
  nodeTypes: ['switch_statement'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    let discriminant = node.childForFieldName('value')
    if (!discriminant) return null

    // Unwrap parenthesized_expression — tree-sitter wraps switch values in parens
    if (discriminant.type === 'parenthesized_expression' && discriminant.namedChildren[0]) {
      discriminant = discriminant.namedChildren[0]
    }

    const typeStr = typeQuery.getTypeAtPosition(
      filePath,
      discriminant.startPosition.row,
      discriminant.startPosition.column,
    )
    if (!typeStr) return null

    // Only check union types (contains ' | ')
    if (!typeStr.includes(' | ')) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Check if there's a default clause
    const hasDefault = body.namedChildren.some(
      c => c.type === 'switch_default',
    )
    if (hasDefault) return null

    // Count case clauses and extract their values
    const caseClauses = body.namedChildren.filter(c => c.type === 'switch_case')
    const caseCount = caseClauses.length
    const unionMembers = typeStr.split(' | ').map(s => s.trim()).filter(Boolean)

    // Extract actual case values for comparison against union members
    const caseValues = new Set<string>()
    for (const caseClause of caseClauses) {
      const caseValue = caseClause.childForFieldName('value')
      if (caseValue) {
        // Normalize: strip quotes from string literals to compare with union type members
        let valText = caseValue.text
        if ((valText.startsWith('"') && valText.endsWith('"')) ||
            (valText.startsWith("'") && valText.endsWith("'"))) {
          valText = `"${valText.slice(1, -1)}"`
        }
        caseValues.add(valText)
      }
    }

    // Check if all case values match known union/enum members
    // Normalize union members for comparison (they may be quoted strings like "foo")
    const normalizedMembers = new Set(unionMembers.map(m => {
      if ((m.startsWith('"') && m.endsWith('"')) ||
          (m.startsWith("'") && m.endsWith("'"))) {
        return `"${m.slice(1, -1)}"`
      }
      return m
    }))

    // If all union members are covered by case values, skip (exhaustive)
    const allCovered = [...normalizedMembers].every(m => caseValues.has(m))
    if (allCovered && caseCount >= unionMembers.length) return null

    if (caseCount < unionMembers.length) {
      const missing = unionMembers.length - caseCount
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Non-exhaustive switch statement',
        `Switch on \`${typeStr}\` has ${caseCount} case(s) but the type has ${unionMembers.length} possible values — ${missing} case(s) missing. Add a \`default\` clause or handle all members.`,
        sourceCode,
        'Add missing case clauses for all union members, or add a `default` clause.',
      )
    }

    return null
  },
}
