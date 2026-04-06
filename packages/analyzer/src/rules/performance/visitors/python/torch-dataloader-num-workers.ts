import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const torchDataloaderNumWorkersVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/torch-dataloader-num-workers',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let name = ''
    if (fn.type === 'identifier') name = fn.text
    else if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) name = attr.text
    }

    if (name !== 'DataLoader') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check for num_workers keyword argument
    let hasNumWorkers = false
    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const argName = arg.childForFieldName('name')
        if (argName?.text === 'num_workers') {
          hasNumWorkers = true
          const value = arg.childForFieldName('value')
          if (value?.text === '0') {
            return makeViolation(
              this.ruleKey, node, filePath, 'medium',
              'DataLoader with num_workers=0',
              'DataLoader with num_workers=0 loads data in the main process, which is a bottleneck for GPU training.',
              sourceCode,
              'Set num_workers to a positive value (e.g., 4 or os.cpu_count()) for parallel data loading.',
            )
          }
        }
      }
    }

    // If no num_workers specified at all, it defaults to 0
    if (!hasNumWorkers) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'DataLoader without num_workers',
        'DataLoader defaults to num_workers=0, loading data in the main process. This is a bottleneck for GPU training.',
        sourceCode,
        'Set num_workers to a positive value (e.g., 4 or os.cpu_count()) for parallel data loading.',
      )
    }

    return null
  },
}
