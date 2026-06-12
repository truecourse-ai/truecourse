/**
 * Deterministic detection of spec-document changes in a PR.
 *
 * TrueCourse treats every Markdown file (outside build/output dirs) as a
 * potential spec document — the same discovery rule the scanner uses. So a PR
 * "changes spec docs" when its changed-file list includes any such `.md` file.
 * This is the cheap, deterministic trigger that offers the (LLM-backed) scan.
 */

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.git',
  '.truecourse',
  '.cache',
  'coverage',
]);

/** Whether a repo-relative path is a discoverable spec document. */
export function isSpecDoc(filePath: string): boolean {
  if (!/\.(md|markdown)$/i.test(filePath)) return false;
  return !filePath.split('/').some((seg) => SKIP_DIRS.has(seg));
}

/** The spec documents among a PR's changed files (added/modified/removed). */
export function detectSpecDocChanges(changedFiles: string[]): string[] {
  return changedFiles.filter(isSpecDoc);
}

/** Source files the analyzer can reason about (TS/JS/Python). */
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py)$/i;

/** Whether a repo-relative path is analyzable source (outside build dirs). */
export function isCodeFile(filePath: string): boolean {
  if (!CODE_EXT.test(filePath)) return false;
  return !filePath.split('/').some((seg) => SKIP_DIRS.has(seg));
}

/** Does the PR touch analyzable code (so inference is worth offering)? */
export function hasCodeChanges(changedFiles: string[]): boolean {
  return changedFiles.some(isCodeFile);
}
