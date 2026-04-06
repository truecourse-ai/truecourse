import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonBroadExceptionRaisedVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/broad-exception-raised',
  languages: ['python'],
  nodeTypes: ['raise_statement'],
  visit(node, filePath, sourceCode) {
    // raise Exception(...) or raise BaseException(...)
    const callNode = node.namedChildren.find((c) => c.type === 'call')
    if (!callNode) return null
    const fn = callNode.childForFieldName('function')
    if (!fn) return null
    const name = fn.type === 'identifier' ? fn.text : null
    if (name !== 'Exception' && name !== 'BaseException') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Broad exception raised',
      `Raising \`${name}\` is too broad. Use a specific exception class like \`ValueError\`, \`RuntimeError\`, or a custom exception.`,
      sourceCode,
      'Replace with a specific exception class that conveys the error type.',
    )
  },
}
