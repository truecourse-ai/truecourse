import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detects: bare `except:` clause that is not the last handler in a try statement
// This would be a SyntaxError in Python if the bare except is followed by other handlers
export const pythonDefaultExceptNotLastVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/default-except-not-last',
  languages: ['python'],
  nodeTypes: ['try_statement'],
  visit(node, filePath, sourceCode) {
    const handlers = node.namedChildren.filter((c) => c.type === 'except_clause')

    if (handlers.length < 2) return null

    // Check if a bare except appears before others
    for (let i = 0; i < handlers.length - 1; i++) {
      const handler = handlers[i]
      const children = handler.children
      const exceptKw = children.find((c) => c.type === 'except')
      const colon = children.find((c) => c.text === ':')

      if (!exceptKw || !colon) continue

      const exceptIdx = children.findIndex((c) => c.id === exceptKw.id)
      const colonIdx = children.findIndex((c) => c.id === colon.id)
      // A "catch type" is any node between `except` and `:` that denotes
      // an exception class (or tuple of them) or an `as e` binding.
      // Pre-fix the check missed `as_pattern` (from `except X as e:`),
      // causing the rule to misidentify every `except X as e:` as a bare
      // except and fire incorrectly on the following specific handler.
      const hasCatchType = children.slice(exceptIdx + 1, colonIdx).some(
        (c) =>
          c.type === 'identifier' ||
          c.type === 'tuple' ||
          c.type === 'attribute' ||
          c.type === 'as_pattern' ||
          c.type === 'parenthesized_expression' ||
          c.type === 'subscript' ||
          c.type === 'call',
      )

      if (!hasCatchType) {
        return makeViolation(
          this.ruleKey, handler, filePath, 'high',
          'Default except not last',
          'Bare `except:` clause appears before other exception handlers — this is a SyntaxError in Python. The bare except must be last.',
          sourceCode,
          'Move the bare `except:` clause to after all specific exception handlers.',
        )
      }
    }

    return null
  },
}
