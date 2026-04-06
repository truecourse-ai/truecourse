import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const VERY_LONG_SLEEP = 86400 // 24 hours in seconds

export const pythonAsyncLongSleepVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/async-long-sleep',
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

    // Must be awaited
    const parent = node.parent
    if (parent?.type !== 'await') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null
    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // Check for very large numbers like 1e9, 99999, float('inf'), math.inf
    const text = firstArg.text
    if (text === "float('inf')" || text === 'math.inf' || text === 'float("inf")' || text === 'INF') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Long sleep instead of sleep_forever',
        `\`await sleep(${text})\` — use \`trio.sleep_forever()\` or an event to wait indefinitely.`,
        sourceCode,
        'Use `trio.sleep_forever()` or `asyncio.Event().wait()` instead of sleeping with infinity.',
      )
    }

    const numVal = parseFloat(text)
    if (!isNaN(numVal) && numVal >= VERY_LONG_SLEEP) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Long sleep instead of sleep_forever',
        `\`await sleep(${text})\` is a very long sleep (${numVal}s) — use an event or condition variable instead.`,
        sourceCode,
        'Use `asyncio.Event().wait()`, `trio.sleep_forever()`, or a proper synchronization primitive.',
      )
    }

    return null
  },
}
