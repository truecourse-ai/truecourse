import { Parser, Language } from 'web-tree-sitter'
import type { Tree } from 'web-tree-sitter'
// Aliased import: the esbuild banner in scripts/build.ts already imports
// `createRequire` at the top of the bundle; re-importing under the same
// name would cause "Identifier 'createRequire' has already been declared".
import { createRequire as _createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import type { SupportedLanguage } from '@truecourse/shared'

export type { Tree }

// .wasm files live next to the compiled entry in two layouts:
//   - dist (published CLI bundle): <bundle-dir>/wasm/*.wasm
//   - dev (pnpm workspace + tsc output): resolved via require.resolve of each
//     grammar / web-tree-sitter package
const _require = _createRequire(import.meta.url)

// In the published dist bundle, .wasm files are shipped in `<bundle-dir>/wasm/`
// (see scripts/build.ts). In dev/tests the dir doesn't exist and we resolve
// from node_modules instead via each package's subpath export.
const BUNDLED_WASM_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'wasm',
)

const GRAMMAR_WASM: Record<SupportedLanguage, string> = {
  typescript: 'tree-sitter-typescript/tree-sitter-typescript.wasm',
  tsx:        'tree-sitter-typescript/tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
  python:     'tree-sitter-python/tree-sitter-python.wasm',
}

function resolveWasmPath(subpath: string): string {
  // In the bundled dist, all .wasm files sit in the same dir keyed by basename.
  const bundled = path.join(BUNDLED_WASM_DIR, path.basename(subpath))
  if (fs.existsSync(bundled)) return bundled
  // In dev, each package exposes its .wasm as a resolvable subpath:
  // web-tree-sitter via `exports`; the grammar packages have no `exports` so
  // any subpath works.
  return _require.resolve(subpath)
}

const languageCache = new Map<SupportedLanguage, Language>()
const parserCache = new Map<SupportedLanguage, Parser>()

let initPromise: Promise<void> | null = null
let initialized = false

/**
 * Asynchronously load the web-tree-sitter WASM runtime and every grammar.
 *
 * **Must be awaited before any call to {@link getParser}, {@link parseCode},
 * or {@link parseFile}.** Those helpers are synchronous (the core analyzer
 * relies on that) and will throw if parsers haven't been loaded yet.
 *
 * Idempotent: subsequent calls return the same cached promise, so it's safe
 * to call at the top of every public entry point.
 */
export function initParsers(): Promise<void> {
  if (!initPromise) {
    initPromise = doInit().then(() => { initialized = true })
  }
  return initPromise
}

async function doInit(): Promise<void> {
  await Parser.init({
    locateFile(file: string) {
      return resolveWasmPath(`web-tree-sitter/${file}`)
    },
  })
  await Promise.all(
    (Object.keys(GRAMMAR_WASM) as SupportedLanguage[]).map(async (lang) => {
      const wasmPath = resolveWasmPath(GRAMMAR_WASM[lang])
      const language = await Language.load(wasmPath)
      languageCache.set(lang, language)
    }),
  )
}

function assertInitialized(): void {
  if (!initialized) {
    throw new Error(
      'tree-sitter parsers are not loaded. Call `await initParsers()` from ' +
        '@truecourse/analyzer before using parseCode / parseFile / getParser. ' +
        'This is required once per process — the call is idempotent.',
    )
  }
}

/**
 * Get a cached Parser for the given language. Synchronous.
 *
 * **Precondition:** {@link initParsers} must have been awaited earlier in
 * this process. Throws otherwise.
 */
export function getParser(language: SupportedLanguage): Parser {
  if (!(language in GRAMMAR_WASM)) {
    throw new Error(`Unsupported language: ${language}`)
  }
  assertInitialized()
  let parser = parserCache.get(language)
  if (!parser) {
    const lang = languageCache.get(language)!
    parser = new Parser()
    parser.setLanguage(lang)
    parserCache.set(language, parser)
  }
  return parser
}

/**
 * Parse a source string and return its syntax tree. Synchronous.
 *
 * **Precondition:** {@link initParsers} must have been awaited earlier in
 * this process. Throws otherwise.
 */
export function parseCode(code: string, language: SupportedLanguage): Tree {
  const parser = getParser(language)
  const tree = parser.parse(code)
  if (!tree) {
    throw new Error(`Failed to parse ${language} code`)
  }
  return tree
}

/**
 * Parse a file's contents and return its syntax tree. Synchronous.
 *
 * **Precondition:** {@link initParsers} must have been awaited earlier in
 * this process. Throws otherwise.
 */
export function parseFile(
  filePath: string,
  code: string,
  language: SupportedLanguage,
): Tree {
  try {
    return parseCode(code, language)
  } catch (error) {
    throw new Error(
      `Failed to parse file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
