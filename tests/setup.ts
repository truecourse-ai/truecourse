import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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

// Make the USER-level store hermetic for the same reason git is: `~/.truecourse/
// config.json` holds the developer's LLM transport selection, and any test that
// renders a model name reads it. On a machine configured for the `api` transport
// that leaks the configured model into assertions expecting the `claude-code`
// defaults (`expected 'gpt-5.5-2' to be 'opus'`), so the suite passes in CI and
// fails locally. An empty per-process dir gives every test the same cold-start
// defaults CI has. Tests that exercise global config point this at their own temp
// dir and restore it; those that `delete` it fall back to the real home, which is
// exactly what they did before this pin existed.
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-test-home-'))
process.env.TRUECOURSE_HOME = testHome
process.on('exit', () => {
  fs.rmSync(testHome, { recursive: true, force: true })
})

// Load tree-sitter WASM grammars once before any test runs.
// initParsers() is idempotent (returns cached promise), so repeated imports
// across test files all hit the same initialization.
await initParsers()
