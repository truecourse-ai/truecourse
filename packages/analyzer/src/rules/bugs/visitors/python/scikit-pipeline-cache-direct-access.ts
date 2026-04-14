import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects direct access to Pipeline steps/named_steps that bypasses caching.
 * Patterns: pipeline.steps[N], pipeline.named_steps['name'], pipeline.named_steps.name
 */
export const pythonScikitPipelineCacheDirectAccessVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/scikit-pipeline-cache-direct-access',
  languages: ['python'],
  nodeTypes: ['subscript'],
  visit(node, filePath, sourceCode) {
    const value = node.childForFieldName('value')
    if (!value) return null

    // Check for pattern: something.steps[N] or something.named_steps[...]
    if (value.type === 'attribute') {
      const attr = value.childForFieldName('attribute')
      if (!attr) return null

      const attrName = attr.text
      if (attrName === 'steps' || attrName === 'named_steps') {
        // Heuristic: the object name should contain 'pipeline', 'pipe', or 'pl'
        const obj = value.childForFieldName('object')
        if (!obj) return null
        const objText = obj.text.toLowerCase()
        if (objText.includes('pipeline') || objText.includes('pipe') || objText === 'pl') {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Pipeline transformer accessed directly',
            `Direct access to \`${value.text}\` bypasses Pipeline caching. Use \`pipeline[index]\` or access via Pipeline API instead.`,
            sourceCode,
            'Access transformers through the Pipeline API rather than directly via `.steps[]` or `.named_steps[]`.',
          )
        }
      }
    }

    return null
  },
}
