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

      // Skip when usage is inside a function body — the function only executes
      // after module initialization, so the const IS defined by execution time
      let parent = earliestUseSite.node.parent
      let insideFunction = false
      while (parent) {
        if (parent.type === 'function_declaration' || parent.type === 'arrow_function' ||
            parent.type === 'function_expression' || parent.type === 'method_definition') {
          insideFunction = true
          break
        }
        parent = parent.parent
      }
      if (insideFunction) continue
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
