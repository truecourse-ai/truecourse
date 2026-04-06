import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInsidePythonLoop } from './_helpers.js'

const PYTHON_CAST_FUNCTIONS = new Set(['int', 'float', 'str', 'bool', 'list', 'tuple', 'dict', 'set', 'bytes'])

export const runtimeCastOverheadVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/runtime-cast-overhead',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier') return null
    if (!PYTHON_CAST_FUNCTIONS.has(fn.text)) return null

    if (!isInsidePythonLoop(node)) return null

    // Only flag if it looks like the same conversion is repeated (heuristic: the argument is the loop variable)
    // Simple heuristic: just flag type casts in loops
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Type casting in loop',
      `${fn.text}() called inside a loop. If the type is known, consider pre-processing the data before the loop.`,
      sourceCode,
      'Pre-process or convert data before the loop to avoid per-iteration cast overhead.',
    )
  },
}
