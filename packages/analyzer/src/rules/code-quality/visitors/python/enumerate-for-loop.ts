import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonEnumerateForLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/enumerate-for-loop',
  languages: ['python'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    // Pattern: for i in range(len(something))
    const right = node.childForFieldName('right')
    if (!right || right.type !== 'call') return null

    const fn = right.childForFieldName('function')
    if (!fn || fn.type !== 'identifier' || fn.text !== 'range') return null

    const rangeArgs = right.childForFieldName('arguments')
    if (!rangeArgs) return null
    const rangeArgsChildren = rangeArgs.namedChildren.filter((a) => a.type !== 'keyword_argument')

    // range(len(iterable)) - single arg
    if (rangeArgsChildren.length !== 1) return null
    const lenCall = rangeArgsChildren[0]
    if (!lenCall || lenCall.type !== 'call') return null
    const lenFn = lenCall.childForFieldName('function')
    if (!lenFn || lenFn.text !== 'len') return null

    const lenArgs = lenCall.childForFieldName('arguments')
    if (!lenArgs) return null
    const iterableNode = lenArgs.namedChildren[0]
    if (!iterableNode) return null

    const loopVar = node.childForFieldName('left')
    const loopVarName = loopVar?.text || 'i'
    const iterableName = iterableNode.text

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Manual index tracking in loop',
      `\`for ${loopVarName} in range(len(${iterableName}))\` should use \`enumerate(${iterableName})\`.`,
      sourceCode,
      `Replace with \`for ${loopVarName}, item in enumerate(${iterableName}):\` to get both index and value.`,
    )
  },
}
