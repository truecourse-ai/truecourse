import fs from 'node:fs';
import { ensureRepoTruecourseDir, getRepoUiStatePath } from './paths.js';

// ---------------------------------------------------------------------------
// Shape of <repo>/.truecourse/ui-state.json
// ---------------------------------------------------------------------------

export type Position = { x: number; y: number };

export interface UiState {
  /** Keyed by `<branch>/<level>` → stable-key → position. */
  positions: Record<string, Record<string, Position>>;
  /** Keyed by `<branch>/<level>` → list of collapsed stable-keys. */
  collapsed: Record<string, string[]>;
}

const EMPTY_STATE: UiState = { positions: {}, collapsed: {} };

export function scopeKey(branch: string | null | undefined, level: string): string {
  return `${branch || 'HEAD'}/${level}`;
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

export function readUiState(repoDir: string): UiState {
  const file = getRepoUiStatePath(repoDir);
  if (!fs.existsSync(file)) return structuredClone(EMPTY_STATE);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<UiState>;
    return {
      positions: parsed.positions ?? {},
      collapsed: parsed.collapsed ?? {},
    };
  } catch {
    return structuredClone(EMPTY_STATE);
  }
}

export function writeUiState(repoDir: string, state: UiState): void {
  ensureRepoTruecourseDir(repoDir);
  fs.writeFileSync(getRepoUiStatePath(repoDir), JSON.stringify(state, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Mutators (scoped by branch + level)
// ---------------------------------------------------------------------------

export function setPositions(
  repoDir: string,
  branch: string | null | undefined,
  level: string,
  positions: Record<string, Position>,
): void {
  const state = readUiState(repoDir);
  state.positions[scopeKey(branch, level)] = positions;
  writeUiState(repoDir, state);
}

export function clearPositions(
  repoDir: string,
  branch: string | null | undefined,
  level: string,
): void {
  const state = readUiState(repoDir);
  delete state.positions[scopeKey(branch, level)];
  writeUiState(repoDir, state);
}

export function setCollapsed(
  repoDir: string,
  branch: string | null | undefined,
  level: string,
  collapsed: string[],
): void {
  const state = readUiState(repoDir);
  state.collapsed[scopeKey(branch, level)] = collapsed;
  writeUiState(repoDir, state);
}

export function getScopedPositions(
  repoDir: string,
  branch: string | null | undefined,
  level: string,
): Record<string, Position> {
  return readUiState(repoDir).positions[scopeKey(branch, level)] ?? {};
}

export function getScopedCollapsed(
  repoDir: string,
  branch: string | null | undefined,
  level: string,
): string[] {
  return readUiState(repoDir).collapsed[scopeKey(branch, level)] ?? [];
}
