import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonNoDebuggerVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-debugger',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // breakpoint()
    if (fn.type === 'identifier' && fn.text === 'breakpoint') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Debugger statement',
        '`breakpoint()` must be removed before deploying to production.',
        sourceCode,
        'Remove the breakpoint() call.',
      )
    }

    // pdb.set_trace()
    if (fn.type === 'attribute') {
      const obj = fn.childForFieldName('object')
      const attr = fn.childForFieldName('attribute')
      if (obj?.text === 'pdb' && attr?.text === 'set_trace') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Debugger statement',
          '`pdb.set_trace()` must be removed before deploying to production.',
          sourceCode,
          'Remove the pdb.set_trace() call.',
        )
      }
    }

    return null
  },
}
