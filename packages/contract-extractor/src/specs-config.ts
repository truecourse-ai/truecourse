/**
 * `.truecourse/specs.yaml` reader/writer + glob-aware spec resolver.
 *
 * The file declares which prose specs the extractor reads, in what
 * layering order. Phase 8 only handles the first spec entry (no
 * layering); Phase 11 honours rank-based override.
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import type { SpecsConfig, SpecsConfigEntry } from './types.js';
import { SpecsConfigSchema } from './types.js';

export const SPECS_CONFIG_FILE = path.join('.truecourse', 'specs.yaml');

export function specsConfigPath(repoRoot: string): string {
  return path.join(repoRoot, SPECS_CONFIG_FILE);
}

export function readSpecsConfig(repoRoot: string): SpecsConfig | null {
  const file = specsConfigPath(repoRoot);
  if (!fs.existsSync(file)) return null;
  const raw = yaml.load(fs.readFileSync(file, 'utf-8'));
  return SpecsConfigSchema.parse(raw);
}

export function writeSpecsConfig(repoRoot: string, config: SpecsConfig): void {
  const file = specsConfigPath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, yaml.dump(config, { lineWidth: 100 }));
}

/**
 * Resolve a config entry's `file` field (which may be a glob) into an
 * ordered list of absolute paths to existing files. Globs supported:
 * `*` and `**`. Returns paths sorted lexicographically so glob expansion
 * is deterministic.
 *
 * Globs are resolved relative to the repo root; absolute paths are
 * rejected — specs must live inside the repo.
 */
export function resolveSpecEntry(repoRoot: string, entry: SpecsConfigEntry): string[] {
  if (path.isAbsolute(entry.file)) {
    throw new Error(`Specs entry uses an absolute path: ${entry.file}`);
  }
  if (!entry.file.includes('*')) {
    const full = path.join(repoRoot, entry.file);
    return fs.existsSync(full) && fs.statSync(full).isFile() ? [full] : [];
  }
  return globExpand(repoRoot, entry.file);
}

// ---------------------------------------------------------------------------
// Tiny glob — `*` matches one path segment, `**` matches any number.
// ---------------------------------------------------------------------------

function globExpand(repoRoot: string, pattern: string): string[] {
  const parts = pattern.split('/');
  const results: string[] = [];
  walkGlob(repoRoot, parts, 0, results);
  return results.sort();
}

function walkGlob(currentDir: string, parts: string[], idx: number, out: string[]): void {
  if (idx >= parts.length) {
    if (fs.existsSync(currentDir) && fs.statSync(currentDir).isFile()) out.push(currentDir);
    return;
  }
  const part = parts[idx];
  const isLast = idx === parts.length - 1;

  if (part === '**') {
    // Match zero-or-more directory segments, then continue with parts[idx+1].
    walkGlob(currentDir, parts, idx + 1, out);
    if (!fs.existsSync(currentDir) || !fs.statSync(currentDir).isDirectory()) return;
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      if (entry.isDirectory()) walkGlob(path.join(currentDir, entry.name), parts, idx, out);
    }
    return;
  }

  if (!part.includes('*')) {
    walkGlob(path.join(currentDir, part), parts, idx + 1, out);
    return;
  }

  // Single-star glob within one segment, e.g. `*.md` or `adr-*.md`.
  if (!fs.existsSync(currentDir) || !fs.statSync(currentDir).isDirectory()) return;
  const re = globRegex(part);
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (!re.test(entry.name)) continue;
    const next = path.join(currentDir, entry.name);
    if (isLast) {
      if (entry.isFile()) out.push(next);
    } else if (entry.isDirectory()) {
      walkGlob(next, parts, idx + 1, out);
    }
  }
}

function globRegex(pattern: string): RegExp {
  let re = '^';
  for (const ch of pattern) {
    if (ch === '*') re += '[^/]*';
    else if (/[.+^${}()|[\]\\]/.test(ch)) re += `\\${ch}`;
    else re += ch;
  }
  return new RegExp(re + '$');
}
