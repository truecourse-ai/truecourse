/**
 * Shared source-walking + language dispatch for code-side extractors.
 *
 * Before this, every extractor re-implemented the same directory walk,
 * hardcoded the `.ts/.tsx/.js/.jsx` extension set, and mapped extensions
 * to a tree-sitter language inline. That made adding a language a
 * cross-cutting edit touching every extractor.
 *
 * Now: one walker (`eachParsedSource`) maps a file to its language via a
 * single registry and yields a parsed tree. Extractors declare a
 * per-language matcher map and let `makeDirExtractor` drive the dispatch
 * — adding a language is a new entry in the map, never a structural
 * change.
 *
 * Tree lifetime: tree-sitter `Tree` objects are backed by a fixed-size
 * WASM heap allocation that isn't freed until `tree.delete()` is called.
 * Long verify runs over large monorepos (~6000+ files) exhaust the heap
 * if trees aren't disposed promptly. This walker disposes each tree in a
 * `finally` block after `visit()` returns — safe because matchers eagerly
 * reduce the tree to plain data (`ExtractedEnum` etc. carry only
 * `SourceLocation`, never `SyntaxNode`). Other direct `parseFile` callers
 * (auth-presence, file-based-routes, idempotency-presence, the operation
 * extractor in `extractor/index.ts`) follow the same per-file dispose
 * pattern with their own `finally` blocks.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Tree } from 'web-tree-sitter';
import type { SupportedLanguage } from '@truecourse/shared';
import { initParsers, parseFile } from '@truecourse/analyzer';
import { loadTcIgnore } from '@truecourse/shared';

export type { SupportedLanguage } from '@truecourse/shared';

export interface ParsedSource {
  filePath: string;
  source: string;
  tree: Tree;
  lang: SupportedLanguage;
}

/** Extension → tree-sitter language. The single source of truth for
 *  which files the verifier's extractors look at. Add a language here +
 *  a matcher entry in each extractor. */
const EXT_TO_LANG: Record<string, SupportedLanguage> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
};

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'coverage',
  '.cache', '.truecourse', '__pycache__', '.venv', 'venv', '.mypy_cache',
]);

export function languageForFile(filePath: string): SupportedLanguage | null {
  return EXT_TO_LANG[path.extname(filePath)] ?? null;
}

/** All recognized source extensions (for callers that filter by ext). */
export const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set(Object.keys(EXT_TO_LANG));

/**
 * Walk `rootDir`, parse every recognized source file, and call `visit`
 * with the parsed tree + its language. Parse failures on a single file
 * are non-fatal (skipped) — same convention every extractor used.
 */
export async function eachParsedSource(
  rootDir: string,
  visit: (s: ParsedSource) => void,
): Promise<void> {
  await initParsers();
  const tcIgnore = loadTcIgnore(rootDir);
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (tcIgnore.ignores(full)) continue;
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const lang = EXT_TO_LANG[path.extname(entry.name)];
      if (!lang) continue;
      let source: string;
      try {
        source = fs.readFileSync(full, 'utf-8');
      } catch {
        continue;
      }
      let tree: Tree | undefined;
      try {
        tree = parseFile(full, source, lang);
        visit({ filePath: full, source, tree, lang });
      } catch {
        // Parse failure or visit error on one file is non-fatal.
      } finally {
        tree?.delete();
      }
    }
  };
  walk(rootDir);
}

/** A per-file matcher: turn one parsed source into zero+ typed records. */
export type FileMatcher<T> = (s: ParsedSource) => T[];

export type LanguageMatchers<T> = Partial<Record<SupportedLanguage, FileMatcher<T>>>;

/** Register one matcher for all three JS-family dialects at once. */
export function jsMatchers<T>(matcher: FileMatcher<T>): LanguageMatchers<T> {
  return { typescript: matcher, tsx: matcher, javascript: matcher };
}

/**
 * Build a `(rootDir) => Promise<T[]>` extractor from a per-language
 * matcher map. Files in a language with no matcher are skipped. Adding
 * a language = add a key; no other extractor code changes.
 */
export function makeDirExtractor<T>(
  matchers: LanguageMatchers<T>,
): (rootDir: string) => Promise<T[]> {
  return async (rootDir: string): Promise<T[]> => {
    const out: T[] = [];
    await eachParsedSource(rootDir, (s) => {
      const matcher = matchers[s.lang];
      if (matcher) out.push(...matcher(s));
    });
    return out;
  };
}
