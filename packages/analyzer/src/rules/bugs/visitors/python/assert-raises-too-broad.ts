import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { BROAD_EXCEPTIONS } from './_helpers.js'

export const pythonAssertRaisesTooBroadVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/assert-raises-too-broad',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Match pytest.raises(...)
    let isPytestRaises = false
    if (fn.type === 'attribute') {
      const obj = fn.childForFieldName('object')
      const attr = fn.childForFieldName('attribute')
      if (obj?.text === 'pytest' && attr?.text === 'raises') isPytestRaises = true
    }
    if (!isPytestRaises) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const argText = firstArg.type === 'identifier' ? firstArg.text : null
    if (argText && BROAD_EXCEPTIONS.has(argText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'pytest.raises with broad exception',
        `\`pytest.raises(${argText})\` is too broad — the test will pass even if the wrong exception is raised. Use a more specific exception type.`,
        sourceCode,
        `Replace \`${argText}\` with a more specific exception class.`,
      )
    }

    return null
  },
}
