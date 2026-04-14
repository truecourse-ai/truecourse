import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonExceptionNotFromBaseExceptionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/exception-not-from-base-exception',
  languages: ['python'],
  nodeTypes: ['raise_statement', 'except_clause'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'raise_statement') {
      const raised = node.namedChildren[0]
      if (!raised) return null
      // Raising a literal (int, float, string, boolean, list, dict, tuple, set) is always wrong
      const badTypes = new Set(['integer', 'float', 'string', 'concatenated_string', 'list', 'dictionary', 'set', 'true', 'false', 'none'])
      if (badTypes.has(raised.type)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'critical',
          'Exception not derived from BaseException',
          `Raising a \`${raised.type}\` literal will cause a TypeError — only instances or subclasses of BaseException can be raised.`,
          sourceCode,
          'Raise an exception instance or class that derives from BaseException.',
        )
      }
    }
    if (node.type === 'except_clause') {
      // Look for `except 42:` — numeric or other literal as exception type
      const children = node.children
      const exceptIdx = children.findIndex((c) => c.text === 'except')
      const colonIdx = children.findIndex((c) => c.text === ':')
      if (exceptIdx === -1 || colonIdx === -1) return null
      const typeNodes = children.slice(exceptIdx + 1, colonIdx).filter((c) => c.type !== 'comment')
      for (const t of typeNodes) {
        if (t.type === 'integer' || t.type === 'float' || t.type === 'concatenated_string') {
          return makeViolation(
            this.ruleKey, t, filePath, 'critical',
            'Exception not derived from BaseException',
            `Catching a \`${t.type}\` literal in an except clause will raise a TypeError — only BaseException subclasses can be caught.`,
            sourceCode,
            'Replace the literal with a valid exception class.',
          )
        }
      }
    }
    return null
  },
}
