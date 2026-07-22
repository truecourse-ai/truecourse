import os from 'node:os'
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

// No test may ever spawn the developer's real `claude` binary: production LLM
// runners spawn it by default, so an unstubbed runner in a test must fail fast
// (ENOENT) instead of silently making real, billed model calls. Tests that
// exercise binary RESOLUTION itself save/replace/restore these vars per case.
process.env.CLAUDE_CODE_BINARY = '/nonexistent/claude-test-tripwire'

// Make git hermetic: hide the developer's global/system git config from every
// git invocation in the suite (tests and the code under test alike). Otherwise
// host settings leak in — e.g. `commit.gpgsign=true` makes commits in temp
// fixture repos die with "user.signingkey needs to be configured". This mirrors
// CI, which has no global config. Tests that commit must set user.name/email
// per-repo (or via GIT_AUTHOR_*/GIT_COMMITTER_* env), as CI already requires.
process.env.GIT_CONFIG_GLOBAL = os.devNull
process.env.GIT_CONFIG_NOSYSTEM = '1'

// Load tree-sitter WASM grammars once before any test runs.
// initParsers() is idempotent (returns cached promise), so repeated imports
// across test files all hit the same initialization.
await initParsers()
