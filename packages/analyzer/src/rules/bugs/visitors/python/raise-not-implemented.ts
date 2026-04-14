import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonRaiseNotImplementedVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/raise-not-implemented',
  languages: ['python'],
  nodeTypes: ['raise_statement'],
  visit(node, filePath, sourceCode) {
    const raised = node.namedChildren[0]
    if (!raised) return null

    // raise NotImplemented — an identifier, not a call
    if (raised.type === 'identifier' && raised.text === 'NotImplemented') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'raise NotImplemented instead of NotImplementedError',
        '`raise NotImplemented` raises a TypeError (NotImplemented is not an exception). Use `raise NotImplementedError` instead.',
        sourceCode,
        'Change `raise NotImplemented` to `raise NotImplementedError`.',
      )
    }

    // raise NotImplemented() — a call expression
    if (raised.type === 'call') {
      const fn = raised.childForFieldName('function')
      if (fn?.type === 'identifier' && fn.text === 'NotImplemented') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'raise NotImplemented instead of NotImplementedError',
          '`raise NotImplemented()` raises a TypeError (NotImplemented is not an exception class). Use `raise NotImplementedError()` instead.',
          sourceCode,
          'Change `raise NotImplemented()` to `raise NotImplementedError()`.',
        )
      }
    }

    return null
  },
}
