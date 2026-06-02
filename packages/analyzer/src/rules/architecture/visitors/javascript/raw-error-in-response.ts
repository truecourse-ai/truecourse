import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const rawErrorInResponseVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/raw-error-in-response',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    if (!filePath.match(/(?:route|controller|handler|api|server)/i)) return null

    const body = node.childForFieldName('body')
    if (!body) return null
    const bodyText = body.text

    const param = node.childForFieldName('parameter')
    if (!param) return null
    const errName = param.text.replace(/:.+/, '').trim()

    // res.json(err) / res.send(err) — passing the whole error is always unsafe.
    if (bodyText.match(new RegExp(`res\\.(?:json|send)\\(${errName}\\)`))) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Error details exposed in API response',
        `Error details (stack, message) from '${errName}' sent to client. This leaks implementation details.`,
        sourceCode,
        'Send a generic error message to the client and log the full error server-side.',
      )
    }

    // Find each `errName.message` / `errName.stack` reference and classify
    // the surrounding context. Skip cases where the access is:
    //   - gated by an `errName instanceof X` check (curated error class —
    //     the message has been blessed by the developer)
    //   - used as a computed property key: `OBJ[err.message]`
    //   - fed into a pattern matcher: `match(err.message)` / `.with(err.message)`
    //   - passed to a React state setter: `setSomething(err.message ...)`
    const usagePattern = new RegExp(`\\b${errName}\\.(?:message|stack)\\b`, 'g')
    // An `errName instanceof X` gate anywhere earlier in the catch body
    // blesses subsequent `errName.message`/`.stack` reads, even when the
    // gate is far above (e.g. wrapping a logger call with a large
    // structured-fields object). Scan once for any such gate; per-usage
    // checks only need the immediate prefix below.
    const instanceofGated = new RegExp(`\\b${errName}\\s+instanceof\\b`).test(bodyText)
    let hasUnsafeUsage = false
    for (const usage of bodyText.matchAll(usagePattern)) {
      const idx = usage.index ?? 0
      const before = bodyText.slice(Math.max(0, idx - 200), idx)

      // Computed-member access: prev non-space char is `[`
      if (/\[\s*$/.test(before)) continue
      // Pattern-matcher input
      if (/(?:\bmatch|\.with)\s*\(\s*$/.test(before)) continue
      // React state setter call
      if (/\bset[A-Z]\w*\s*\(\s*$/.test(before)) continue
      // Inside an instanceof-gated branch
      if (instanceofGated) continue

      hasUnsafeUsage = true
      break
    }

    if (hasUnsafeUsage) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Error details exposed in API response',
        `Error details (stack, message) from '${errName}' sent to client. This leaks implementation details.`,
        sourceCode,
        'Send a generic error message to the client and log the full error server-side.',
      )
    }

    return null
  },
}
