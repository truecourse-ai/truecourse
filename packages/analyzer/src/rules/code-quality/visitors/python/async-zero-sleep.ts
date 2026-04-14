import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAsyncZeroSleepVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/async-zero-sleep',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let isSleep = false
    if (fn.type === 'identifier' && fn.text === 'sleep') {
      isSleep = true
    } else if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr?.text === 'sleep') isSleep = true
    }
    if (!isSleep) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null
    const firstArg = args.namedChildren[0]
    if (!firstArg) return null
    if (firstArg.text !== '0' && firstArg.text !== '0.0') return null

    // Check if inside async context
    const parent = node.parent
    if (parent?.type === 'await') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Async zero-duration sleep',
        '`await sleep(0)` is a manual checkpoint — use `await asyncio.sleep(0)` explicitly, or prefer `trio.lowlevel.checkpoint()` for trio code.',
        sourceCode,
        'Use `await asyncio.sleep(0)` for an explicit checkpoint, or restructure to avoid manual yielding.',
      )
    }
    return null
  },
}
