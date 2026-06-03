/**
 * Per-repo dashboard UI state (`<repo>/.truecourse/ui-state.json`): graph node
 * positions + collapse state, scoped by `<branch>/<level>`. File-backed by
 * default (OSS/local); the enterprise edition injects a Postgres-backed impl via
 * `setUiStateStore`. Async so a DB impl is possible; the file impl wraps `fs`.
 */

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
// Store interface + file-backed default
// ---------------------------------------------------------------------------

/** Pluggable per-repo UI-state store. File-backed by default; EE injects Postgres. */
export interface UiStateStore {
  readUiState(repoDir: string): Promise<UiState>;
  writeUiState(repoDir: string, state: UiState): Promise<void>;
}

class FileUiStateStore implements UiStateStore {
  async readUiState(repoDir: string): Promise<UiState> {
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

  async writeUiState(repoDir: string, state: UiState): Promise<void> {
    ensureRepoTruecourseDir(repoDir);
    fs.writeFileSync(getRepoUiStatePath(repoDir), JSON.stringify(state, null, 2), 'utf-8');
  }
}

let active: UiStateStore = new FileUiStateStore();

/** The active UI-state store (file-backed unless EE installed a Postgres one). */
export function getUiStateStore(): UiStateStore {
  return active;
}
/** Install a UI-state store (e.g. the enterprise Postgres impl). */
export function setUiStateStore(store: UiStateStore): void {
  active = store;
}
/** Restore the file-backed default (tests). */
export function resetUiStateStore(): void {
  active = new FileUiStateStore();
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

export const readUiState = (repoDir: string): Promise<UiState> => active.readUiState(repoDir);
export const writeUiState = (repoDir: string, state: UiState): Promise<void> =>
  active.writeUiState(repoDir, state);

// ---------------------------------------------------------------------------
// Mutators (scoped by branch + level) — read-modify-write composites
// ---------------------------------------------------------------------------

export async function setPositions(
  repoDir: string,
  branch: string | null | undefined,
  level: string,
  positions: Record<string, Position>,
): Promise<void> {
  const state = await active.readUiState(repoDir);
  state.positions[scopeKey(branch, level)] = positions;
  await active.writeUiState(repoDir, state);
}

export async function clearPositions(
  repoDir: string,
  branch: string | null | undefined,
  level: string,
): Promise<void> {
  const state = await active.readUiState(repoDir);
  delete state.positions[scopeKey(branch, level)];
  await active.writeUiState(repoDir, state);
}

export async function setCollapsed(
  repoDir: string,
  branch: string | null | undefined,
  level: string,
  collapsed: string[],
): Promise<void> {
  const state = await active.readUiState(repoDir);
  state.collapsed[scopeKey(branch, level)] = collapsed;
  await active.writeUiState(repoDir, state);
}

export async function getScopedPositions(
  repoDir: string,
  branch: string | null | undefined,
  level: string,
): Promise<Record<string, Position>> {
  return (await active.readUiState(repoDir)).positions[scopeKey(branch, level)] ?? {};
}

export async function getScopedCollapsed(
  repoDir: string,
  branch: string | null | undefined,
  level: string,
): Promise<string[]> {
  return (await active.readUiState(repoDir)).collapsed[scopeKey(branch, level)] ?? [];
}
