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

      const exceptIdx = children.indexOf(exceptKw)
      const colonIdx = children.indexOf(colon)
      const hasCatchType = children.slice(exceptIdx + 1, colonIdx).some(
        (c) => c.type === 'identifier' || c.type === 'tuple' || c.type === 'attribute'
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
