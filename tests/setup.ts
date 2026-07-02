import { initParsers } from '../packages/analyzer/src/parser'

// Never emit usage telemetry from the test suite — analyze and the
// spec→verify track all call trackEvent when given a `source`, and we don't
// want tests hitting PostHog. (`spec-telemetry.test.ts` mocks trackEvent
// directly to assert it's called.)
process.env.TRUECOURSE_TELEMETRY = '0'

// Never fetch live model prices from OpenRouter in tests — the pre-flight cost
// estimate falls back to bundled list prices. (`model-prices.test.ts` deletes
// this to exercise the real fetch/cache path against a stubbed `fetch`.)
process.env.TRUECOURSE_NO_PRICE_FETCH = '1'

// Load tree-sitter WASM grammars once before any test runs.
// initParsers() is idempotent (returns cached promise), so repeated imports
// across test files all hit the same initialization.
await initParsers()
