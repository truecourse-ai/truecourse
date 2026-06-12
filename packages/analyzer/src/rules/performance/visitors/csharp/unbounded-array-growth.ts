import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { findEnclosingCSharpLoop } from './_helpers.js'

/**
 * `.Add()/.Enqueue()/.Push()` inside a while/do loop with no visible bound —
 * the polling-loop accumulator that grows until OOM. for/foreach loops are
 * bounded by their iteration source and never flagged. Mirrors the JS
 * visitor's skips:
 *   - data-bounded conditions (`while ((line = reader.ReadLine()) != null)`,
 *     `while (queue.TryDequeue(out var item))`) — any call in the condition
 *   - threshold conditions with an advancing variable (`while (i < n)` where
 *     the body reassigns `i`)
 *   - loops that prune or bound the collection (`.Count` plus
 *     Remove/Dequeue/Clear/break)
 */
const GROW_METHODS = new Set(['Add', 'Enqueue', 'Push'])

const CONDITION_IGNORE_IDS = new Set([
  'true', 'false', 'null', 'this', 'Count', 'Length', 'Math', 'DateTime', 'Environment',
])

function conditionContainsCall(condition: SyntaxNode): boolean {
  if (condition.type === 'invocation_expression') return true
  for (const child of condition.namedChildren) {
    if (child && conditionContainsCall(child)) return true
  }
  return false
}

function collectIdentifiers(node: SyntaxNode, out: Set<string>): void {
  if (node.type === 'identifier') out.add(node.text)
  for (const child of node.namedChildren) {
    if (child) collectIdentifiers(child, out)
  }
}

export const csharpUnboundedArrayGrowthVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/unbounded-array-growth',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const method = getCSharpMethodName(node)
    if (!GROW_METHODS.has(method)) return null
    if (getCSharpReceiver(node) === '') return null

    const loop = findEnclosingCSharpLoop(node)
    if (!loop) return null
    // for/foreach iterate a bounded source
    if (loop.type !== 'while_statement' && loop.type !== 'do_statement') return null

    const condition = loop.childForFieldName('condition')
    const body = loop.childForFieldName('body')
    if (condition && body) {
      // Data-bounded: the condition consumes from a source that runs dry.
      if (conditionContainsCall(condition)) return null

      // Threshold-bounded: ordering comparison whose variable advances in the body.
      const condText = condition.text
      if (/(?:^|[^<>=!])(?:<=?|>=?)(?!=)/.test(condText)) {
        const ids = new Set<string>()
        collectIdentifiers(condition, ids)
        const bodyText = body.text
        for (const id of ids) {
          if (CONDITION_IGNORE_IDS.has(id)) continue
          const reassign = new RegExp(`\\b${id}\\s*(?:=[^=]|\\+\\+|--|\\+=|-=)|(?:\\+\\+|--)\\s*${id}\\b`)
          if (reassign.test(bodyText)) return null
        }
      }
    }

    // Pruned/bounded collections: a Count check paired with removal or break.
    const loopText = loop.text
    if (loopText.includes('.Count') && /\b(Remove|RemoveAt|RemoveRange|Dequeue|Clear|Pop|TrimExcess|break)\b/.test(loopText)) {
      return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      `${method}() in unbounded loop`,
      `${method}() inside a while loop with no visible bound or pruning grows the collection until the process runs out of memory.`,
      sourceCode,
      'Cap the collection size (drop oldest entries past a limit) or use a bounded structure like Channel.CreateBounded().',
    )
  },
}
