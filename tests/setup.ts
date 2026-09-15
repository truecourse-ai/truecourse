import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initParsers } from '../packages/source-facts/src/parser'

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

// The server's RUNTIME DIRECTORY gets its own per-process temp dir: a run's
// scratch (its session journal, its clone, the log) must never land in the
// developer's home, and two test files must never share one.
const testRuntimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-test-runtime-'))
process.env.TRUECOURSE_RUNTIME_DIR = testRuntimeDir
process.on('exit', () => {
  fs.rmSync(testRuntimeDir, { recursive: true, force: true })
})

// The transport selection gets its own pin. The code under test loads the
// developer's repo-root `.env` (core's env loader), where
// `TRUECOURSE_LLM_TRANSPORT=claude-code` is how a self-hosted dashboard runs on
// its operator's Claude Code — and that flips every dashboard route test into
// operator mode. dotenv never overwrites a key that already exists, so an EMPTY
// value holds against the file, and every reader treats empty as unset. Tests
// that exercise the override set or delete it per case, as before.
process.env.TRUECOURSE_LLM_TRANSPORT = ''

// Load tree-sitter WASM grammars once before any test runs.
// initParsers() is idempotent (returns cached promise), so repeated imports
// across test files all hit the same initialization.
await initParsers()
