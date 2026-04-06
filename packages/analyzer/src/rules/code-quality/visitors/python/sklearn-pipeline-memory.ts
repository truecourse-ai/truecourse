import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonSklearnPipelineMemoryVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/sklearn-pipeline-memory',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let isPipeline = false
    if (fn.type === 'identifier' && fn.text === 'Pipeline') {
      isPipeline = true
    } else if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr?.text === 'Pipeline') isPipeline = true
    }

    if (!isPipeline) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const hasMemory = args.namedChildren.some((child) => {
      if (child.type === 'keyword_argument') {
        const key = child.childForFieldName('name')
        return key?.text === 'memory'
      }
      return false
    })

    if (!hasMemory) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Scikit-Learn Pipeline without memory',
        '`Pipeline` is created without a `memory` parameter. Without caching, repeated `fit()` calls recompute all transformers, which is wasteful during cross-validation.',
        sourceCode,
        'Add `memory` parameter: `Pipeline(..., memory="path/to/cache")` or `memory=joblib.Memory(location=".", verbose=0)`.',
      )
    }

    return null
  },
}
