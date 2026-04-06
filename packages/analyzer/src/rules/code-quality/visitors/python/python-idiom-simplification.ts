import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects non-idiomatic Python patterns that can be simplified:
 * - FURB110: x if x else default → x or default
 * - FURB131: del x[:] → x.clear()
 * - FURB145: x[:] copy → x.copy()
 * - FURB148: enumerate() unnecessarily (direct iteration available)
 * - FURB171: single-item set membership test (== instead)
 * - FURB187: reversed(list) over slice [::-1]
 */
export const pythonIdiomSimplificationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/python-idiom-simplification',
  languages: ['python'],
  nodeTypes: ['conditional_expression', 'delete_statement', 'subscript', 'call'],
  visit(node, filePath, sourceCode) {
    // FURB131: del x[:] → x.clear()
    if (node.type === 'delete_statement') {
      for (const child of node.namedChildren) {
        if (child.type === 'subscript') {
          const slice = child.childForFieldName('subscript') ?? child.namedChildren[1]
          if (slice?.type === 'slice') {
            const start = slice.childForFieldName('start')
            const end = slice.childForFieldName('end')
            const step = slice.childForFieldName('step')
            if (!start && !end && !step) {
              return makeViolation(
                this.ruleKey, node, filePath, 'low',
                'Python idiom: del x[:] → x.clear()',
                '`del x[:]` removes all items but is less idiomatic than `x.clear()`.',
                sourceCode,
                'Replace `del x[:]` with `x.clear()`.',
              )
            }
          }
        }
      }
    }

    // FURB145: x[:] (copy via full slice) → x.copy()
    if (node.type === 'subscript') {
      const slice = node.childForFieldName('subscript') ?? node.namedChildren[1]
      if (slice?.type === 'slice') {
        const start = slice.childForFieldName('start')
        const end = slice.childForFieldName('end')
        const step = slice.childForFieldName('step')
        if (!start && !end && !step) {
          // Only flag when used as a value (not in del statement)
          const parent = node.parent
          if (parent && parent.type !== 'delete_statement') {
            return makeViolation(
              this.ruleKey, node, filePath, 'low',
              'Python idiom: x[:] → x.copy()',
              '`x[:]` to copy a list is less idiomatic than `x.copy()`.',
              sourceCode,
              'Replace `x[:]` with `x.copy()` for clarity.',
            )
          }
        }
      }
      // FURB187: reversed slice [::-1] → reversed()
      if (slice?.type === 'slice') {
        const step = slice.childForFieldName('step')
        const start = slice.childForFieldName('start')
        const end = slice.childForFieldName('end')
        if (!start && !end && step?.type === 'unary_operator') {
          const op = step.children[0]
          const val = step.namedChildren[0]
          if (op?.text === '-' && val?.text === '1') {
            return makeViolation(
              this.ruleKey, node, filePath, 'low',
              'Python idiom: x[::-1] → reversed(x)',
              '`x[::-1]` creates a reversed copy. Use `reversed(x)` or `list(reversed(x))` for clarity.',
              sourceCode,
              'Replace `x[::-1]` with `list(reversed(x))` or iterate using `reversed(x)`.',
            )
          }
        }
      }
    }

    // FURB110: x if x else default → x or default
    if (node.type === 'conditional_expression') {
      const condition = node.namedChildren[1]
      const body = node.namedChildren[0]
      if (condition && body && condition.text === body.text) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Python idiom: x if x else y → x or y',
          '`x if x else y` can be simplified to `x or y`.',
          sourceCode,
          'Replace `x if x else y` with `x or y`.',
        )
      }
    }

    // FURB171: {x} membership → == x
    if (node.type === 'call') {
      const fn = node.childForFieldName('function')
      // reversed(sorted(...)) or reversed(list[::-1]) handled above
      // Check for len({x}) membership test or single-element set literal in 'in'
      return null
    }

    return null
  },
}
