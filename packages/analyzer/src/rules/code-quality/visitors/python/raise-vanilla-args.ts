import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const LONG_MESSAGE_THRESHOLD = 50

export const pythonRaiseVanillaArgsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/raise-vanilla-args',
  languages: ['python'],
  nodeTypes: ['raise_statement'],
  visit(node, filePath, sourceCode) {
    // raise SomeException("very long message here...")
    const exception = node.namedChildren[0]
    if (!exception || exception.type !== 'call') return null

    const args = exception.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg || firstArg.type !== 'string') return null

    const msgText = firstArg.text
    if (msgText.length <= LONG_MESSAGE_THRESHOLD) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Long message in exception constructor',
      'Long exception messages should be extracted to a custom exception class or constant for reusability.',
      sourceCode,
      'Define a custom exception class with the message or extract to a constant.',
    )
  },
}
