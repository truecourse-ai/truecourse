import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Expression of type void used in a non-statement position.
 * Corresponds to @typescript-eslint/no-confusing-void-expression.
 */
export const confusingVoidExpressionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/confusing-void-expression',
  languages: TS_LANGUAGES,
  nodeTypes: ['return_statement'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    const value = node.namedChildren[0]
    if (!value) return null

    // `return undefined` is explicit, not confusing — skip
    if (value.text === 'undefined') return null

    // `return undefined as T` is an intentional type cast — skip
    if (value.type === 'as_expression') {
      const expr = value.childForFieldName('expression') ?? value.namedChildren[0]
      if (expr?.text === 'undefined') return null
    }

    // Check if the returned expression is void
    const isVoid = typeQuery.isVoidType(
      filePath,
      value.startPosition.row,
      value.startPosition.column,
    )
    if (!isVoid) return null

    // Check that the containing function doesn't have void return type itself
    // (returning void from void function is fine, it's shorthand).
    let parent = node.parent
    let containingFn: typeof node | null = null
    while (parent) {
      if (parent.type === 'arrow_function') {
        // Arrow functions with expression body: `() => voidFn()` — this is fine
        if (parent.childForFieldName('body')?.type !== 'statement_block') {
          return null
        }
        containingFn = parent
        break
      }
      if (parent.type === 'function_declaration' || parent.type === 'function_expression' ||
          parent.type === 'method_definition') {
        containingFn = parent
        break
      }
      parent = parent.parent
    }

    // Mirrors `@typescript-eslint/no-confusing-void-expression`'s
    // `ignoreVoidReturningFunctions` option. Two shapes:
    //   (1) Any return value from an arrow whose own type is void/Promise<void>
    //       — the tRPC/Express handler pattern.
    //   (2) `return await voidFn()` from a non-arrow (function declaration,
    //       function expression, class method) whose own type is
    //       void/Promise<void>. The explicit `await` signals deliberate
    //       void-forwarding — retry helpers (recursive `return await self()`)
    //       and async-method delegations (`return await this.helper()`) use
    //       this to preserve the stack trace while still waiting on the
    //       inner promise. Without the `await` requirement, `function f() {
    //       return sideEffect() }` would silently bypass the rule.
    const isContainingFnVoid = (): boolean => {
      if (!containingFn) return false
      const fnReturnType = typeQuery.getReturnType(
        filePath,
        containingFn.startPosition.row,
        containingFn.startPosition.column,
        containingFn.endPosition.row,
        containingFn.endPosition.column,
      )
      return !!fnReturnType && /^(void|undefined|Promise<\s*(void|undefined)\s*>)$/.test(fnReturnType)
    }
    if (containingFn?.type === 'arrow_function') {
      if (isContainingFnVoid()) return null
    } else if (
      value.type === 'await_expression' &&
      (containingFn?.type === 'function_declaration' ||
        containingFn?.type === 'function_expression' ||
        containingFn?.type === 'method_definition' ||
        containingFn?.type === 'function')
    ) {
      if (isContainingFnVoid()) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Returning void expression',
      `Returning a void expression — \`${value.text.slice(0, 40)}\` returns \`undefined\`. This is confusing because it looks like the return value matters.`,
      sourceCode,
      'Put the expression on its own line and use a bare `return` statement.',
    )
  },
}
