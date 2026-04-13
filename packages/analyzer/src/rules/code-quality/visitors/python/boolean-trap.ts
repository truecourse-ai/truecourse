import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonBooleanTrapVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/boolean-trap',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null
    // Only flag non-trivial function calls (not builtins)
    if (fn.type === 'attribute') return null // method calls like obj.method(True) skip for now

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const positional = args.namedChildren.filter((a) => a.type !== 'keyword_argument')

    for (const arg of positional) {
      if (arg.type === 'true' || arg.type === 'false') {
        // Skip if only arg and function is a common constructor/builtin
        const fnText = fn.text
        if (['bool', 'int', 'str', 'list', 'dict', 'set', 'print', 'sorted', 'reversed', 'filter', 'any', 'all'].includes(fnText)) return null

        // Skip getattr/setattr/hasattr — the boolean is a default value, not a flag
        if (['getattr', 'setattr', 'hasattr'].includes(fnText)) return null

        // Skip Pydantic Field() calls — booleans are default values, not flags
        if (fnText === 'Field') return null

        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Boolean positional argument',
          `\`${fnText}(${arg.text}, ...)\` — positional boolean makes the call intent unclear. Use a keyword argument instead.`,
          sourceCode,
          'Use a keyword argument to clarify intent: e.g., `func(verbose=True)` instead of `func(True)`.',
        )
      }
    }
    return null
  },
}
