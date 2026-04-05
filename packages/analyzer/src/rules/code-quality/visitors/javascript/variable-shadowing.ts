import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { DataFlowContext } from '../../../../data-flow/types.js'

export const variableShadowingVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/variable-shadowing',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  needsDataFlow: true,
  visit(node, filePath, sourceCode, dataFlow?: DataFlowContext) {
    if (!dataFlow) return null
    const shadows = dataFlow.shadowedVariables()
    for (const { inner, outer } of shadows) {
      // Skip parameters — they commonly shadow outer variables intentionally
      if (inner.kind === 'parameter') continue
      // Skip catch parameters — often named 'e', 'err', etc. and shadow outer
      if (inner.kind === 'catch-parameter') continue
      return makeViolation(
        this.ruleKey,
        inner.declarationNode,
        filePath,
        'medium',
        'Variable shadowing',
        `Variable \`${inner.name}\` shadows an outer variable declared in the ${outer.scope.kind} scope. Rename one of them to avoid confusion.`,
        sourceCode,
        'Rename either the inner or outer variable to make the code clearer and avoid accidental shadowing.',
      )
    }
    return null
  },
}
