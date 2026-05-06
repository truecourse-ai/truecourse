import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const undefinedPassedAsOptionalVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/undefined-passed-as-optional',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argList = args.namedChildren
    if (argList.length === 0) return null

    const lastArg = argList[argList.length - 1]
    if (lastArg.text !== 'undefined') return null

    // Skip React hooks where undefined is the standard initial value
    // Handles both `useState(undefined)` and `React.useState(undefined)`
    const fn = node.childForFieldName('function')
    let fnName = fn?.text ?? ''
    if (fn && fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) fnName = prop.text
    }
    if (/^use[A-Z]/.test(fnName)) return null

    // React `createContext<T | undefined>(undefined)` — canonical idiom
    // for "no default; throw inside provider when consumed without one".
    if (fnName === 'createContext') return null

    // Form-library setters where `undefined` is meaningful as "clear":
    //   form.setValue('field', undefined)   — react-hook-form
    //   field.onChange(undefined)           — controlled inputs
    //   setError(undefined), reset(undefined)
    // These take REQUIRED positional args, so the trailing `undefined`
    // is not "redundant optional" — it's the actual cleared value.
    if (
      /^set[A-Z]/.test(fnName) ||
      fnName === 'onChange' ||
      fnName === 'reset' ||
      fnName === 'mutate' ||
      fnName === 'mutateAsync' ||
      fnName === 'dispatch' ||
      fnName === 'send'
    ) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Explicit undefined as optional argument',
      'Passing `undefined` explicitly as a trailing argument is redundant — just omit it.',
      sourceCode,
      'Remove the explicit `undefined` argument — optional parameters default to `undefined` automatically.',
    )
  },
}
