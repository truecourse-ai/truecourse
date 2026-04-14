import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUnnecessaryEmptyIterableInDequeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-empty-iterable-in-deque',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    // Detect deque([]) or collections.deque([])
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let isDeque = false
    if (fn.type === 'identifier' && fn.text === 'deque') {
      isDeque = true
    } else if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr?.text === 'deque') isDeque = true
    }

    if (!isDeque) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argList = args.namedChildren
    if (argList.length === 0) return null

    const firstArg = argList[0]
    // Only flag deque([]) — empty list as first positional arg
    if (!firstArg || firstArg.type !== 'list') return null
    if (firstArg.namedChildCount !== 0) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unnecessary empty iterable in deque()',
      '`deque([])` is equivalent to `deque()` — remove the empty list argument.',
      sourceCode,
      'Replace `deque([])` with `deque()`.',
    )
  },
}
