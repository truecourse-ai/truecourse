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

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      `Useless setState: ${fn.text}(${stateVarName})`,
      `\`${fn.text}(${stateVarName})\` sets state to the current value — this is a no-op.`,
      sourceCode,
      `Remove the \`${fn.text}(${stateVarName})\` call or update it with a new value.`,
    )
  },
}
