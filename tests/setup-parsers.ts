import { initParsers } from '../packages/analyzer/src/parser'

// Load tree-sitter WASM grammars once before any test in a parser-dependent
// project runs. Layered on top of `./tests/setup.ts` (the global env guards),
// so it is added ONLY to projects whose tests parse source — analyzer, cli, and
// server. initParsers() is idempotent (returns a cached promise), so repeated
// imports across test files all hit the same one-time initialization.
await initParsers()
