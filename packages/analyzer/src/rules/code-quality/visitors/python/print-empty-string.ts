import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonPrintEmptyStringVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/print-empty-string',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier' || fn.text !== 'print') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argList = args.namedChildren
    // print("") — single empty string argument
    if (argList.length !== 1) return null

    const arg = argList[0]
    if (!arg || arg.type !== 'string') return null

    // Check if the string is empty
    const text = arg.text
    if (text !== '""' && text !== "''") return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'print("") instead of print()',
      '`print("")` is equivalent to `print()` — remove the empty string argument.',
      sourceCode,
      'Replace `print("")` with `print()`.',
    )
  },
}
