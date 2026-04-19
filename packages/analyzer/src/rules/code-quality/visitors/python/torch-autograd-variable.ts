import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

function isTorchAutogradVariable(node: SyntaxNode): boolean {
  // torch.autograd.Variable (attribute access)
  if (node.type !== 'attribute') return false
  const attr = node.childForFieldName('attribute')
  if (attr?.text !== 'Variable') return false
  const obj = node.childForFieldName('object')
  if (!obj || obj.type !== 'attribute') return false
  const objAttr = obj.childForFieldName('attribute')
  const objObj = obj.childForFieldName('object')
  return objAttr?.text === 'autograd' && (objObj?.text === 'torch')
}

export const pythonTorchAutogradVariableVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/torch-autograd-variable',
  languages: ['python'],
  nodeTypes: ['attribute', 'call'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'call') {
      const fn = node.childForFieldName('function')
      if (fn && isTorchAutogradVariable(fn)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Deprecated torch.autograd.Variable',
          '`torch.autograd.Variable` is deprecated since PyTorch 0.4. Tensors now support autograd natively.',
          sourceCode,
          'Replace `torch.autograd.Variable(tensor)` with just `tensor` — PyTorch tensors track gradients directly via `requires_grad=True`.',
        )
      }
      return null
    }

    if (isTorchAutogradVariable(node) && node.parent?.type !== 'call') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Deprecated torch.autograd.Variable reference',
        '`torch.autograd.Variable` is deprecated since PyTorch 0.4. Tensors support autograd directly.',
        sourceCode,
        'Use `torch.tensor(data, requires_grad=True)` instead.',
      )
    }

    return null
  },
}
