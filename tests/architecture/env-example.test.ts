/**
 * Every key `.env.example` documents is one something reads: a `process.env`
 * read in source, or a deployment that sets it. One direction only — the
 * reverse would need an allowlist of internal knobs and rot.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where a key may be referenced: source, infra, and the deploy scripts. */
const ROOTS = ['apps', 'packages', 'ee', 'infra', '.github', 'Dockerfile', 'docker-compose.yml'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo']);
const SOURCE_EXT = new Set(['.ts', '.tsx', '.mjs', '.js', '.sh', '.py', '.bicep', '.yml', '.yaml', '']);

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (SOURCE_EXT.has(path.extname(entry.name))) yield full;
  }
}

function documentedKeys(): string[] {
  const text = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
  const keys = new Set<string>();
  for (const line of text.split('\n')) {
    const m = /^#?\s*([A-Z][A-Z0-9_]+)=/.exec(line);
    if (m) keys.add(m[1]!);
  }
  return [...keys];
}

describe('.env.example', () => {
  it('documents only keys that source or a deployment reads', () => {
    const corpus: string[] = [];
    for (const root of ROOTS) {
      const full = path.join(repoRoot, root);
      if (!fs.existsSync(full)) continue;
      if (fs.statSync(full).isDirectory()) {
        for (const file of walk(full)) corpus.push(fs.readFileSync(file, 'utf8'));
      } else {
        corpus.push(fs.readFileSync(full, 'utf8'));
      }
    }
    const text = corpus.join('\n');
    const unread = documentedKeys().filter((key) => !new RegExp(`\\b${key}\\b`).test(text));
    expect(unread).toEqual([]);
  });
});
