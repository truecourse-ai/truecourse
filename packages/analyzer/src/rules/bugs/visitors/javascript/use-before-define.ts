import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { DataFlowContext } from '../../../../data-flow/types.js'

export const useBeforeDefineVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/use-before-define',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  needsDataFlow: true,
  visit(node, filePath, sourceCode, dataFlow?: DataFlowContext) {
    if (!dataFlow) return null
    const vars = dataFlow.usedBeforeDefined()
    for (const v of vars) {
      // Find the earliest use site that is before the declaration
      const declPos = v.declarationNode.startIndex
      const earliestUseSite = v.useSites
        .filter(u => u.node.startIndex < declPos)
        .sort((a, b) => a.node.startIndex - b.node.startIndex)[0]
      if (!earliestUseSite) continue
      return makeViolation(
        this.ruleKey,
        earliestUseSite.node,
        filePath,
        'high',
        'Variable used before definition',
        `Variable \`${v.name}\` is used before it is declared. Move the declaration above the first use.`,
        sourceCode,
        'Declare the variable before its first use to avoid a ReferenceError (TDZ for let/const).',
      )
    }
    return null
  },
}
