import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { DataFlowContext } from '../../../../data-flow/types.js'

/**
 * If `decl` is an identifier declared by `const [x, setX] = useState(...)`
 * (or `useReducer`), return the enclosing variable_declarator. Otherwise null.
 */
function useStateDestructureFor(decl: SyntaxNode): SyntaxNode | null {
  // The declaration node is the identifier inside an array_pattern.
  const arrayPattern = decl.parent
  if (!arrayPattern || arrayPattern.type !== 'array_pattern') return null
  const declarator = arrayPattern.parent
  if (!declarator || declarator.type !== 'variable_declarator') return null
  const init = declarator.childForFieldName('value')
  if (!init || init.type !== 'call_expression') return null
  const fn = init.childForFieldName('function')
  if (!fn) return null
  const name = fn.text
  if (
    name !== 'useState' &&
    name !== 'React.useState' &&
    name !== 'useReducer' &&
    name !== 'React.useReducer'
  ) {
    return null
  }
  return declarator
}

export const reactUselessSetStateVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/react-useless-set-state',
  languages: ['tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  needsDataFlow: true,
  visit(node, filePath, sourceCode, dataFlow?: DataFlowContext) {
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

    // Matching-by-name alone produces lots of false positives:
    //   - `setNonce(nonce)` where `setNonce` is imported from `react-colorful`
    //     and `nonce` is a prop, not a useState pair.
    //   - `setReadOnly(readOnly)` inside an event handler where the local
    //     `const readOnly = …` is freshly computed and shadows the
    //     outer useState binding by name.
    // Require: the setter resolves to a useState/useReducer destructure AND
    // the argument resolves to the matching binding from the same destructure.
    if (dataFlow) {
      const setterVar = dataFlow.resolveReference(fn)
      const argVar = dataFlow.resolveReference(arg)
      if (!setterVar || !argVar) return null
      const setterDestructure = useStateDestructureFor(setterVar.declarationNode)
      if (!setterDestructure) return null
      const argDestructure = useStateDestructureFor(argVar.declarationNode)
      if (!argDestructure || argDestructure.id !== setterDestructure.id) return null
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
