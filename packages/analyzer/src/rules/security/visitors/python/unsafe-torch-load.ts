import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUnsafeTorchLoadVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unsafe-torch-load',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    let objectName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      const obj = fn.childForFieldName('object')
      if (attr) methodName = attr.text
      if (obj) objectName = obj.text
    }

    if (methodName !== 'load') return null
    if (objectName !== 'torch' && objectName !== '') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Must have at least one argument (the file path)
    if (args.namedChildren.length === 0) return null

    // Check if weights_only=True is set
    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (name?.text === 'weights_only' && value?.text === 'True') {
          return null
        }
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Unsafe torch.load() call',
      'torch.load() without weights_only=True uses pickle, which can execute arbitrary code.',
      sourceCode,
      'Add weights_only=True: torch.load(path, weights_only=True).',
    )
  },
}
