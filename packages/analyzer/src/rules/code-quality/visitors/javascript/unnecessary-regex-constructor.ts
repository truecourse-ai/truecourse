import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unnecessaryRegexConstructorVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-regex-constructor',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['new_expression'],
  visit(node, filePath, sourceCode) {
    const ctor = node.childForFieldName('constructor')
    if (ctor?.text !== 'RegExp') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argList = args.namedChildren
    if (argList.length === 0 || argList.length > 2) return null
    const firstArg = argList[0]
    if (firstArg.type !== 'string') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unnecessary RegExp constructor',
      '`new RegExp("pattern")` with a string literal can be written as a regex literal `/pattern/`.',
      sourceCode,
      'Replace `new RegExp("pattern")` with `/pattern/` for clarity and performance.',
    )
  },
}
