import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

/**
 * `await reader.read()` is the canonical ReadableStream consumption
 * pattern. Returns `{value, done}` and the next call depends on the
 * previous's `done` bit — there is no fixed iteration set to
 * parallelise. Same for any `<X>.next()` async-iterator manual drive.
 */
function isStreamReadCall(node: SyntaxNode): boolean {
  // node is the await_expression; its argument is the actual call.
  const argument = node.namedChildren[0]
  if (!argument || argument.type !== 'call_expression') return false
  const fn = argument.childForFieldName('function')
  if (fn?.type !== 'member_expression') return false
  const property = fn.childForFieldName('property')
  return property?.text === 'read' || property?.text === 'next'
}

/**
 * `await Promise.all([...])` / `await Promise.allSettled([...])` /
 * `await Promise.race([...])` — the await IS the parallel-batch
 * step. The surrounding loop is iterating over batches, not
 * per-item awaiting.
 */
function isPromiseAggregateCall(node: SyntaxNode): boolean {
  const argument = node.namedChildren[0]
  if (!argument || argument.type !== 'call_expression') return false
  const fn = argument.childForFieldName('function')
  if (fn?.type !== 'member_expression') return false
  const obj = fn.childForFieldName('object')
  const prop = fn.childForFieldName('property')
  if (obj?.text !== 'Promise') return false
  return prop?.text === 'all' || prop?.text === 'allSettled' ||
         prop?.text === 'race' || prop?.text === 'any'
}

/**
 * `await sleep(ms)` / `await delay(ms)` / `await wait(ms)` /
 * `await setTimeout(...)` (timers/promises) — intentional
 * throttle / backoff. The serialization is the contract.
 */
function isIntentionalDelayCall(node: SyntaxNode): boolean {
  const argument = node.namedChildren[0]
  if (!argument || argument.type !== 'call_expression') return false
  const fn = argument.childForFieldName('function')
  let name = ''
  if (fn?.type === 'identifier') name = fn.text
  else if (fn?.type === 'member_expression') name = fn.childForFieldName('property')?.text ?? ''
  return name === 'sleep' || name === 'delay' || name === 'wait' ||
         name === 'pause' || name === 'setTimeout'
}

/**
 * Loop is a queue-drain: `while (q.length) { ...; q.shift(); ... }`
 * The serialization is the explicit contract — items can be
 * pushed onto the queue during iteration and the order matters.
 */
function isQueueDrainLoop(loopNode: SyntaxNode): boolean {
  if (loopNode.type !== 'while_statement' && loopNode.type !== 'do_statement') return false
  const cond = loopNode.childForFieldName('condition')
  const body = loopNode.childForFieldName('body')
  if (!cond || !body) return false
  // condition references `<x>.length` (>0 / truthy)
  if (!/\.\s*length\b/.test(cond.text)) return false
  // body contains `<same>.shift()` / `.pop()` / `.dequeue()` / `.poll()`
  if (!/\.\s*(?:shift|pop|dequeue|poll)\s*\(/.test(body.text)) return false
  return true
}

export const awaitInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/await-in-loop',
  languages: JS_LANGUAGES,
  nodeTypes: ['await_expression'],
  visit(node, filePath, sourceCode) {
    // `await stream.read()` / `await iterator.next()` — sequential by
    // protocol; no parallel alternative exists.
    if (isStreamReadCall(node)) return null

    // `await Promise.all([...])` / allSettled / race / any —
    // the await IS the parallel-batch step.
    if (isPromiseAggregateCall(node)) return null

    // `await sleep(ms)` / `delay(ms)` / `wait(ms)` /
    // `setTimeout(...)` — intentional throttle / backoff.
    if (isIntentionalDelayCall(node)) return null

    // Walk up the tree to find if we're inside a loop
    let current: SyntaxNode | null = node.parent
    while (current) {
      const t = current.type
      if (t === 'for_statement' || t === 'for_in_statement' || t === 'while_statement' || t === 'do_statement') {
        // Queue-drain loops (`while (q.length) { q.shift(); await … }`)
        // have explicit-serialization semantics: enqueueing during
        // iteration is the contract.
        if (isQueueDrainLoop(current)) return null
        // Make sure we're in the loop body (not the initializer/condition of a for loop)
        // and not inside a nested async function
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Await inside loop',
          '`await` inside a loop forces sequential execution of async operations. Consider collecting promises and using `Promise.all()` for parallel execution.',
          sourceCode,
          'Extract the async calls into an array and use `await Promise.all(promises)` outside the loop.',
        )
      }
      // Stop recursing if we hit a function boundary
      if (t === 'function_declaration' || t === 'arrow_function' || t === 'function' || t === 'method_definition') {
        break
      }
      current = current.parent
    }
    return null
  },
}
