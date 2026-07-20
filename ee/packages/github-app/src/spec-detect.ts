/**
 * Deterministic detection of spec-document changes in a PR.
 *
 * TrueCourse treats every Markdown file (outside build/output dirs) as a
 * potential spec document — the same discovery rule the scanner uses, down to
 * sharing its extension list, so a doc the scanner reads is never one this gate
 * ignores. So a PR "changes spec docs" when its changed-file list includes any
 * such markdown file.
 * This is the cheap, deterministic trigger that offers the (LLM-backed) scan.
 *
 * The repo's opt-in `spec.include` scope (from `.truecourse/config.json`) narrows
 * that universe the same way the scanner's discovery does — pass the fetched
 * config's scope so the gate never offers a scan for a PR touching only
 * out-of-scope markdown. Detection runs BEFORE any clone, so the config is read
 * over the GitHub API and a fetch/parse failure degrades to "scan everything".
 */

import {
  DOC_DISCOVERY_SKIP_DIRS,
  buildSpecScope,
  hasMarkdownExtension,
  type SpecScope,
} from '@truecourse/shared';

/**
 * Whether a repo-relative path is a discoverable spec document. When a `scope`
 * is given it must also be within the repo's include-scope; an inactive/omitted
 * scope means everything (today's behavior).
 */
export function isSpecDoc(filePath: string, scope?: SpecScope): boolean {
  if (!hasMarkdownExtension(filePath)) return false;
  if (filePath.split('/').some((seg) => DOC_DISCOVERY_SKIP_DIRS.has(seg))) return false;
  return scope ? scope.includes(filePath) : true;
}

/** The spec documents among a PR's changed files (added/modified/removed). */
export function detectSpecDocChanges(changedFiles: string[], scope?: SpecScope): string[] {
  return changedFiles.filter((f) => isSpecDoc(f, scope));
}

/**
 * Build the repo's spec include-scope from its `.truecourse/config.json` content
 * (fetched over the GitHub API — detection runs before any clone). A null /
 * unparseable config, or one without a non-empty `spec.include`, degrades to an
 * inactive scope (scan everything) — never an error.
 */
export function specScopeFromConfigJson(json: string | null): SpecScope {
  if (!json) return buildSpecScope(undefined);
  try {
    const parsed = JSON.parse(json) as { spec?: { include?: unknown } };
    return buildSpecScope(parsed?.spec?.include);
  } catch {
    return buildSpecScope(undefined);
  }
}

/** Source files the analyzer can reason about (TS/JS/Python). */
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py)$/i;

/** Whether a repo-relative path is analyzable source (outside build dirs). */
export function isCodeFile(filePath: string): boolean {
  if (!CODE_EXT.test(filePath)) return false;
  return !filePath.split('/').some((seg) => DOC_DISCOVERY_SKIP_DIRS.has(seg));
}

/** Does the PR touch analyzable code (so a Code Quality analyze is worth running)? */
export function hasCodeChanges(changedFiles: string[]): boolean {
  return changedFiles.some(isCodeFile);
}
