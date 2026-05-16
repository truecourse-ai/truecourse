import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const undefinedPassedAsOptionalVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/undefined-passed-as-optional',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argList = args.namedChildren
    if (argList.length === 0) return null

    const lastArg = argList[argList.length - 1]
    if (lastArg.text !== 'undefined') return null

    // Resolve callee name (handles direct calls and member-expression calls)
    const fn = node.childForFieldName('function')
    let fnName = fn?.text ?? ''
    let isMember = false
    if (fn && fn.type === 'member_expression') {
      isMember = true
      const prop = fn.childForFieldName('property')
      if (prop) fnName = prop.text
    }

    // Skip React hooks where undefined is the standard initial value
    // Handles both `useState(undefined)` and `React.useState(undefined)`
    if (/^use[A-Z]/.test(fnName)) return null

    // Skip React.createContext / createContext — the argument is REQUIRED,
    // not optional, and `undefined` is the canonical "no default" idiom.
    if (fnName === 'createContext') return null

    // Skip react-hook-form-style state-clearing callbacks where `undefined`
    // is a meaningful sentinel for "clear this field":
    //   form.setValue('field', undefined)
    //   field.onChange(undefined)
    //   setX(undefined) / setState(undefined)
    if (fnName === 'setValue' || fnName === 'onChange') return null
    if (/^set[A-Z]/.test(fnName) && argList.length === 1) return null

    // If we have TS type info, skip when the corresponding parameter is typed
    // with an explicit `null` union (e.g. `Partial<T> | undefined | null`).
    // That signature explicitly distinguishes undefined / null / value, so
    // passing `undefined` is semantically meaningful, not a redundant optional.
    if (typeQuery && fn) {
      try {
        const paramTypes = typeQuery.getParameterTypes(
          filePath,
          fn.startPosition.row,
          fn.startPosition.column,
          fn.endPosition.row,
          fn.endPosition.column,
        )
        if (paramTypes && paramTypes.length > 0) {
          const idx = Math.min(argList.length - 1, paramTypes.length - 1)
          const t = paramTypes[idx]?.type ?? ''
          // Explicit `null` in the union means callers are expected to
          // distinguish undefined from null — undefined is intentional.
          if (/\bnull\b/.test(t)) return null
        }
      } catch {
        // Fall through to flagging
      }
    }

    // Discard single-arg member-expression calls that look like state setters
    // / event handlers when we can't resolve the type — these are dominated by
    // legitimate "clear" usage patterns and produce noisy FPs.
    if (isMember && argList.length === 1) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Explicit undefined as optional argument',
      'Passing `undefined` explicitly as a trailing argument is redundant — just omit it.',
      sourceCode,
      'Remove the explicit `undefined` argument — optional parameters default to `undefined` automatically.',
    )
  },
}
