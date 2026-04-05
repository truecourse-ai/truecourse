import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const ASSERT_METHODS = new Set([
  'equal', 'strictEqual', 'deepEqual', 'notEqual', 'notStrictEqual',
  'deepStrictEqual', 'equals', 'strictEquals', 'is', 'isNot',
  'toBe', 'toEqual', 'toStrictEqual', 'toDeepEqual',
])

export const testSameArgumentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/test-same-argument',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (!prop || !ASSERT_METHODS.has(prop.text)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argList = args.namedChildren
    if (argList.length < 2) return null

    const arg1 = argList[0]
    const arg2 = argList[1]

    if (!arg1 || !arg2) return null

    // Skip if either argument is a literal (they could validly be the same e.g. expect(0).toBe(0))
    if (arg1.text === arg2.text && arg1.text.length > 1) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Same argument in assertion',
        `Both arguments of \`${prop.text}()\` are \`${arg1.text}\` — the assertion always passes regardless of actual behavior.`,
        sourceCode,
        'Use different values for actual and expected arguments.',
      )
    }

    return null
  },
}
