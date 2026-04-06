import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { PYTHON_BUILTIN_NON_EXCEPTIONS } from './_helpers.js'

export const pythonExceptNonExceptionClassVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/except-non-exception-class',
  languages: ['python'],
  nodeTypes: ['except_clause'],
  visit(node, filePath, sourceCode) {
    const children = node.children
    const exceptIdx = children.findIndex((c) => c.text === 'except')
    const colonIdx = children.findIndex((c) => c.text === ':')
    if (exceptIdx === -1 || colonIdx === -1) return null

    const typeNodes = children.slice(exceptIdx + 1, colonIdx).filter(
      (c) => c.type !== 'comment' && c.text !== 'as',
    )
    for (const t of typeNodes) {
      // String literal as exception type
      if (t.type === 'string' || t.type === 'integer' || t.type === 'float') {
        return makeViolation(
          this.ruleKey, t, filePath, 'high',
          'Except with non-exception class',
          `\`except ${t.text}:\` catches a literal value, not an exception class — this will raise a TypeError at runtime.`,
          sourceCode,
          'Use an exception class like `Exception` or a specific subclass.',
        )
      }
      // Known non-exception builtin names
      if (t.type === 'identifier' && PYTHON_BUILTIN_NON_EXCEPTIONS.has(t.text)) {
        return makeViolation(
          this.ruleKey, t, filePath, 'high',
          'Except with non-exception class',
          `\`except ${t.text}:\` catches \`${t.text}\` which is not an exception class — this will raise a TypeError at runtime.`,
          sourceCode,
          'Use an exception class. For example, `except TypeError:` or `except ValueError:`.',
        )
      }
    }
    return null
  },
}
