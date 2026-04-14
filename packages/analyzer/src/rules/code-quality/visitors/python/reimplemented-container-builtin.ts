import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonReimplementedContainerBuiltinVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/reimplemented-container-builtin',
  languages: ['python'],
  nodeTypes: ['lambda'],
  visit(node, filePath, sourceCode) {
    // Detect lambda: [] or lambda: {} or lambda: () or lambda *args: list(args)
    const body = node.childForFieldName('body')
    if (!body) return null

    // lambda: [] → list
    if (body.type === 'list' && body.namedChildCount === 0) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Lambda reimplements list',
        '`lambda: []` reimplements the built-in `list` — use `list` directly.',
        sourceCode,
        'Replace `lambda: []` with `list`.',
      )
    }

    // lambda: {} → dict
    if (body.type === 'dictionary' && body.namedChildCount === 0) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Lambda reimplements dict',
        '`lambda: {}` reimplements the built-in `dict` — use `dict` directly.',
        sourceCode,
        'Replace `lambda: {}` with `dict`.',
      )
    }

    // lambda: () → tuple — actually tuple() with no args
    if (body.type === 'tuple' && body.namedChildCount === 0) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Lambda reimplements tuple',
        '`lambda: ()` reimplements the built-in `tuple` — use `tuple` directly.',
        sourceCode,
        'Replace `lambda: ()` with `tuple`.',
      )
    }

    return null
  },
}
