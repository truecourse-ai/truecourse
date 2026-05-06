import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const reactUselessSetStateVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/react-useless-set-state',
  languages: ['tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier') return null

    // setX(x) — setter called with the same state variable name
    if (!/^set[A-Z]/.test(fn.text)) return null

    const stateVarName = fn.text.charAt(3).toLowerCase() + fn.text.slice(4)

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argList = args.namedChildren
    if (argList.length !== 1) return null

    const arg = argList[0]
    if (!arg || arg.type !== 'identifier') return null

    if (arg.text !== stateVarName) return null

    // Skip when the argument resolves to a binding that SHADOWS the
    // state variable in an enclosing scope:
    //   1. a parameter of an enclosing function/arrow/method
    //      (`onChange = (value: string) => setValue(value)`);
    //   2. a local `const`/`let`/`var` declaration that is NOT the
    //      `useState`/`useReducer` destructuring itself (i.e., a fresh
    //      computed value like `const errorMessage = error.message;
    //      setErrorMessage(errorMessage)`).
    //
    // The simple-name-declaration regex matches `const errorMessage = …`
    // / `let errorMessage = …` / `var errorMessage = …`. The
    // useState destructuring (`const [errorMessage, setErrorMessage] =
    // useState(…)`) is intentionally NOT matched: only the state
    // declaration shape itself looks like `const [<arg>, ...]` and we
    // want that one to fire on `set<X>(<x>)` calls in the body.
    const localScalarDeclRe = new RegExp(`\\b(?:const|let|var)\\s+${arg.text}\\b\\s*[:=]`)
    let scope: typeof node.parent = node.parent
    while (scope) {
      // Block-scoped scalar local declaration (`const X = …`). Check
      // BEFORE crossing into the enclosing function so we never see a
      // sibling component's `const X` and falsely conclude the binding
      // shadows the state variable.
      if (
        scope.type === 'statement_block' ||
        scope.type === 'catch_clause' ||
        scope.type === 'for_statement' ||
        scope.type === 'for_in_statement' ||
        scope.type === 'for_of_statement'
      ) {
        if (localScalarDeclRe.test(scope.text)) return null
      }
      if (
        scope.type === 'arrow_function' ||
        scope.type === 'function_declaration' ||
        scope.type === 'function_expression' ||
        scope.type === 'function' ||
        scope.type === 'method_definition'
      ) {
        const params = scope.childForFieldName('parameters')
        if (params) {
          const paramsRe = new RegExp(`\\b${arg.text}\\b`)
          if (paramsRe.test(params.text)) return null
        }
        // Stop at the OUTER React component boundary. A `const value =
        // …` declared in a sibling component (or at module top level)
        // doesn't shadow the state — it's a different scope.
        break
      }
      scope = scope.parent
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      `Useless setState: ${fn.text}(${stateVarName})`,
      `\`${fn.text}(${stateVarName})\` sets state to the current value — this is a no-op.`,
      sourceCode,
      `Remove the \`${fn.text}(${stateVarName})\` call or update it with a new value.`,
    )
  },
}
