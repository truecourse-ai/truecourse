import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects duplicate test case values in pytest.mark.parametrize.
 */
export const pythonPytestDuplicateParametrizeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/pytest-duplicate-parametrize',
  languages: ['python'],
  nodeTypes: ['decorator'],
  visit(node, filePath, sourceCode) {
    // Decorator: @pytest.mark.parametrize(...)
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'call') return null

    const fn = expr.childForFieldName('function')
    if (!fn) return null

    // Check if it's pytest.mark.parametrize
    const fnText = fn.text
    if (!fnText.includes('parametrize')) return null

    const args = expr.childForFieldName('arguments')
    if (!args) return null

    const argNodes = args.namedChildren
    if (argNodes.length < 2) return null

    // Second argument should be a list of test cases
    const caseList = argNodes[1]
    if (caseList.type !== 'list') return null

    const caseTexts = caseList.namedChildren.map((c) => c.text)
    const seen = new Set<string>()
    for (const t of caseTexts) {
      if (seen.has(t)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Duplicate parametrize test case',
          `\`pytest.mark.parametrize\` contains duplicate test case value \`${t}\` — redundant test.`,
          sourceCode,
          'Remove the duplicate test case value.',
        )
      }
      seen.add(t)
    }

    return null
  },
}
