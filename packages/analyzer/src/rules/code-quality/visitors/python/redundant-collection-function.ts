import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const REDUNDANT_WRAPPERS: Record<string, string[]> = {
  list: ['sorted', 'list', 'reversed'],
  set: ['sorted', 'set'],
  tuple: ['sorted', 'tuple'],
}

export const pythonRedundantCollectionFunctionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-collection-function',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier') return null
    const outerName = fn.text

    const innerFunctions = REDUNDANT_WRAPPERS[outerName]
    if (!innerFunctions) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg || firstArg.type !== 'call') return null

    const innerFn = firstArg.childForFieldName('function')
    if (!innerFn || innerFn.type !== 'identifier') return null
    const innerName = innerFn.text

    if (!innerFunctions.includes(innerName)) return null
    if (outerName === innerName) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `Redundant ${outerName}(${innerName}(...))`,
      `Wrapping \`${innerName}(...)\` with \`${outerName}()\` creates an unnecessary intermediate collection.`,
      sourceCode,
      `Remove the \`${outerName}()\` wrapper.`,
    )
  },
}
