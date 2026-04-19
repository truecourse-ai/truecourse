import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

function isTypeCall(node: SyntaxNode): string | null {
  if (node.type !== 'call') return null
  const fn = node.childForFieldName('function')
  if (fn?.type !== 'identifier' || fn.text !== 'type') return null
  const args = node.childForFieldName('arguments')
  if (!args) return null
  const arg = args.namedChildren[0]
  return arg ? arg.text : null
}

export const pythonConfusingTypeCheckVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/confusing-type-check',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    const left = node.namedChildren[0]
    const right = node.namedChildren[node.namedChildren.length - 1]
    if (!left || !right) return null

    const op = node.children.find((c) => !c.isNamed)?.text

    // type(x) == SomeType  or  type(x) is SomeType
    const typeArg = isTypeCall(left)
    if (typeArg !== null) {
      if (op === '==' || op === 'is' || op === 'is not' || op === '!=') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Confusing type check',
          `\`type(${typeArg}) ${op} ...\` for type checking is fragile — it does not handle subclasses. Use \`isinstance(${typeArg}, SomeType)\` instead.`,
          sourceCode,
          `Replace \`type(${typeArg}) ${op} SomeType\` with \`isinstance(${typeArg}, SomeType)\`.`,
        )
      }
    }

    return null
  },
}
