import type { CodeRuleVisitor } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

/**
 * Deduplicated with bugs/deterministic/unhandled-promise.
 *
 * The previous implementation visited every async call in an
 * expression_statement context and flagged it as "async void" — but
 * that's exactly the shape unhandled-promise covers, so every hit
 * was double-reported (78 duplicate violations on OpenHands alone).
 *
 * The CANONICAL async-void-function bug is passing an async function
 * literal as a callback to a void-expecting API:
 *   setInterval(async () => {...}, 1000)
 *   arr.forEach(async (x) => {...})
 *   useEffect(async () => {...})    // React-specific
 *
 * That detection requires walking from the async function literal
 * upward to the enclosing call site and matching against a known
 * void-callback signature. It's a separate rule scope and is
 * deferred for now — the visitor returns null so the rule is a
 * no-op until the canonical detection lands.
 *
 * The negative fixture's `bugs/deterministic/async-void-function`
 * marker has been moved to `bugs/deterministic/unhandled-promise`
 * (same shape, single firing).
 */
export const asyncVoidFunctionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/async-void-function',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  needsTypeQuery: true,
  visit() {
    return null
  },
}
