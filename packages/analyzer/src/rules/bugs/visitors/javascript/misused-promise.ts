import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Returns true when the top-level union of a type string contains a `null` or
 * `undefined` member — e.g. `Promise<void> | undefined`. A nullable value in a
 * boolean condition is a legitimate *existence* check ("has this been assigned
 * yet?"), not the always-truthy bug this rule targets. Nested nullish inside a
 * generic argument (`Promise<string | null>`) is ignored: that promise object
 * is still always truthy, so `if (p)` on it is still a bug.
 */
function topLevelUnionHasNullish(typeStr: string): boolean {
  let depth = 0
  let member = ''
  const members: string[] = []
  for (const ch of typeStr) {
    if (ch === '<' || ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === '>' || ch === ')' || ch === ']' || ch === '}') depth--
    if (ch === '|' && depth === 0) {
      members.push(member)
      member = ''
      continue
    }
    member += ch
  }
  members.push(member)
  return members.some((m) => {
    const t = m.trim()
    return t === 'null' || t === 'undefined'
  })
}

/**
 * Detect: Promise used in boolean context without await (if, while, ternary, &&, ||).
 * Corresponds to @typescript-eslint/no-misused-promises.
 */
export const misusedPromiseVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/misused-promise',
  languages: TS_LANGUAGES,
  nodeTypes: ['if_statement', 'while_statement', 'do_statement', 'for_statement', 'ternary_expression'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    let condition: typeof node | null = null
    if (node.type === 'ternary_expression') {
      condition = node.namedChildren[0] ?? null
    } else {
      condition = node.childForFieldName('condition')
    }
    if (!condition) return null

    // Unwrap parenthesized_expression to get the inner expression
    while (condition && condition.type === 'parenthesized_expression' && condition.namedChildren.length > 0) {
      condition = condition.namedChildren[0]
    }
    if (!condition) return null

    // Skip if the condition is an await expression
    if (condition.type === 'await_expression') return null

    const isPromise = typeQuery.isPromiseLike(
      filePath,
      condition.startPosition.row,
      condition.startPosition.column,
      condition.endPosition.row,
      condition.endPosition.column,
    )
    if (isPromise) {
      // Skip nullable promises (`Promise<T> | undefined`): a condition like
      // `if (maybePromise)` is an intentional existence/init guard, not the
      // always-truthy mistake this rule flags. A bare `Promise<T>` has no
      // nullish member and still fires.
      const condType = typeQuery.getTypeAtPosition(
        filePath,
        condition.startPosition.row,
        condition.startPosition.column,
        condition.endPosition.row,
        condition.endPosition.column,
      )
      if (condType && topLevelUnionHasNullish(condType)) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Promise used in conditional without await',
        'A Promise is used in a boolean context — Promises are always truthy, so this condition will always pass. Add `await` to check the resolved value.',
        sourceCode,
        'Add `await` before the Promise expression in the condition.',
      )
    }
    return null
  },
}
