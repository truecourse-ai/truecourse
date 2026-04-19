import { initParsers } from '../packages/analyzer/src/parser'

// Load tree-sitter WASM grammars once before any test runs.
// initParsers() is idempotent (returns cached promise), so repeated imports
// across test files all hit the same initialization.
await initParsers()
