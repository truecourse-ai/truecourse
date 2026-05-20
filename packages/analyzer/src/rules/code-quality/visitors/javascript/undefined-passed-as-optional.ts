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

    // Require at least three positional arguments before flagging.
    //
    // With one or two args we cannot tell from syntax alone whether the
    // trailing `undefined` is a redundant optional or a meaningful "clear"
    // value passed to a required parameter. Real-world callers regularly
    // hand `undefined` to required params on purpose:
    //
    //   form.setValue(name, undefined)      // RHF: value is required
    //   field.onChange(undefined)           // RHF: value is required
    //   createContext<T | undefined>(undefined)  // React: default required
    //   buildMeta(settings, undefined)      // domain-specific, value required
    //
    // The rule is intentionally conservative here — a function whose only
    // trailing arg is genuinely optional almost always has 3+ args in real
    // codebases (the optional param is typically `options?`, `meta?`,
    // `signal?` after a series of required args).
    if (argList.length < 3) return null

    // Skip React hooks where undefined is the standard initial value
    // Handles both `useState(undefined)` and `React.useState(undefined)`
    const fn = node.childForFieldName('function')
    let fnName = fn?.text ?? ''
    if (fn && fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) fnName = prop.text
    }
    if (/^use[A-Z]/.test(fnName)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Explicit undefined as optional argument',
      'Passing `undefined` explicitly as a trailing argument is redundant — just omit it.',
      sourceCode,
      'Remove the explicit `undefined` argument — optional parameters default to `undefined` automatically.',
    )
  },
}
