import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

function containsAwait(stmt: SyntaxNode): boolean {
  if (stmt.type === 'await_expression') return true
  for (let i = 0; i < stmt.namedChildCount; i++) {
    const child = stmt.namedChild(i)
    if (child && containsAwait(child)) return true
  }
  return false
}

export const elementOverwriteVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/element-overwrite',
  languages: JS_LANGUAGES,
  nodeTypes: ['statement_block'],
  visit(node, filePath, sourceCode) {
    // Look for consecutive assignments to the same array index/object key (literal)
    const statements = node.namedChildren.filter((c) => c.type !== 'comment')

    // Collect assignment targets (expression_statement > assignment_expression)
    const assigns = new Map<string, { node: SyntaxNode; idx: number }>()

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i]
      if (stmt.type !== 'expression_statement') continue

      const expr = stmt.namedChildren[0]
      if (!expr || expr.type !== 'assignment_expression') continue

      const left = expr.childForFieldName('left')
      if (!left) continue

      // Only handle subscript (arr[0]) and member access (obj.key)
      if (left.type !== 'subscript_expression' && left.type !== 'member_expression') continue

      const obj = left.childForFieldName('object')
      const indexOrProp = left.type === 'subscript_expression'
        ? left.childForFieldName('index')
        : left.childForFieldName('property')

      if (!obj || !indexOrProp) continue

      // Only flag literal indices/property names for certainty
      if (indexOrProp.type !== 'string' && indexOrProp.type !== 'number' && indexOrProp.type !== 'property_identifier') continue

      const key = `${obj.text}[${indexOrProp.text}]`

      if (assigns.has(key)) {
        const prev = assigns.get(key)!
        // Check if the key was read between the two assignments
        let wasRead = false
        let hasAwait = false
        for (let j = prev.idx + 1; j < i; j++) {
          const between = statements[j]
          if (between.text.includes(obj.text)) {
            wasRead = true
            break
          }
          if (!hasAwait && containsAwait(between)) hasAwait = true
        }
        // React useRef lock idiom: `xRef.current = true; await ...; xRef.current = false`.
        // The await yields the event loop, so re-entrant callers can observe
        // the first assignment via the ref's shared `.current`. Skip the
        // violation when an intervening await crosses the two assignments and
        // the property is the React `.current` accessor.
        const isRefCurrent =
          left.type === 'member_expression' && indexOrProp.text === 'current'
        if (!wasRead && !(isRefCurrent && hasAwait)) {
          return makeViolation(
            this.ruleKey, expr, filePath, 'high',
            'Element overwritten before read',
            `\`${key}\` is assigned again before being read — the first assignment has no effect.`,
            sourceCode,
            'Remove the first assignment or use the value before overwriting it.',
          )
        }
      }

      assigns.set(key, { node: expr, idx: i })
    }

    return null
  },
}
