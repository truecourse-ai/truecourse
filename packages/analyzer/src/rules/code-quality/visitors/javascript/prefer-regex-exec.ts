import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const preferRegexExecVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-regex-exec',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (prop?.text !== 'match') return null

    const args = node.childForFieldName('arguments')
    const firstArg = args?.namedChildren[0]
    if (!firstArg) return null

    if (firstArg.type === 'regex') {
      const flagsNode = firstArg.namedChildren.find((c) => c.type === 'regex_flags')
      const flags = flagsNode?.text ?? ''
      if (!flags.includes('g')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Prefer RegExp.exec() over String.match()',
          '`String.match()` without the `g` flag should use `RegExp.exec()` for clarity.',
          sourceCode,
          'Replace `str.match(/regex/)` with `/regex/.exec(str)` for non-global matching.',
        )
      }
    }
    return null
  },
}
