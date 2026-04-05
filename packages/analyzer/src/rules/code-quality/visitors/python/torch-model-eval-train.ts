import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects torch model state loading (load_state_dict) without a subsequent
 * .eval() or .train() call.
 */
export const pythonTorchModelEvalTrainVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/torch-model-eval-train',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const attr = fn.childForFieldName('attribute')
    if (!attr || attr.text !== 'load_state_dict') return null

    const obj = fn.childForFieldName('object')
    if (!obj) return null
    const modelName = obj.text

    // Check if .eval() or .train() is called on the same object in nearby code
    const nodeStart = node.startPosition.row
    const lines = sourceCode.split('\n')
    const searchRange = lines.slice(nodeStart, nodeStart + 10).join('\n')

    if (searchRange.includes(`${modelName}.eval()`) || searchRange.includes(`${modelName}.train()`)) {
      return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Missing model.eval() or model.train() after load',
      `\`${modelName}.load_state_dict()\` called without a subsequent \`${modelName}.eval()\` or \`${modelName}.train()\` — model may be in training mode when inference is expected.`,
      sourceCode,
      `Add \`${modelName}.eval()\` for inference or \`${modelName}.train()\` for training after loading state.`,
    )
  },
}
