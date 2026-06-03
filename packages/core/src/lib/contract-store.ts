/**
 * Contract corpus store. The default is file-backed (OSS/local — a `.tc` tree
 * under `<repo>/.truecourse/contracts/`, unchanged); the enterprise edition
 * injects a content-addressed Postgres/Blob impl via `setContractStore`.
 *
 * The seam is **directory-oriented**: the IL writers/readers
 * (`@truecourse/contract-extractor` `writeContracts`, `@truecourse/contract-verifier`
 * `verify`/`writeInferred`) are opaque directory producers/consumers — they plan
 * `.tc` paths internally and recursively walk the tree. So the boundary is
 * "persist this tree" / "give me back this tree"; content-addressing is the EE
 * adapter's private concern, invisible to core and to OSS.
 *
 * Keyed by `RepoRef` (an opaque repo handle + the git commit the set was
 * produced at). The file impl maps the handle to a path and ignores the commit
 * (OSS keeps the single-working-tree + git model); the EE impl keys rows by
 * (repo, commit).
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Identity of one persisted set. `repoKey` is the opaque per-repo handle (a
 * filesystem path for the file impl; a stable repo id — e.g. the GitHub
 * `owner/repo` — for EE). `commitSha` is the git SHA the set was produced at:
 * GitHub App = PR head; local = HEAD; dirty tree falls back to HEAD; `''` = a
 * non-git workspace (the file impl ignores it, the EE impl rejects it).
 */
export interface RepoRef {
  repoKey: string;
  commitSha: string;
}

/** Independent lifecycles: authored contracts vs reverse-engineered (`infer`). */
export type ContractKind = 'contracts' | 'contracts_inferred';

/**
 * A materialized contract tree on local disk, laid out exactly like the kind's
 * root, ready to hand to `verify()` / `infer()`. Callers MUST call `cleanup()`
 * in a `finally`.
 */
export interface MaterializedDir {
  /** Absolute path to a directory laid out like the kind's root. */
  dir: string;
  /**
   * Idempotent. EE: `rm -rf` the temp dir. File impl: a guaranteed no-op — the
   * dir is the user's real repo, so deleting it would be catastrophic.
   */
  cleanup(): Promise<void>;
}

export interface SaveContractsResult {
  /** posix path (relative to kind root) → sha256, for the saved set. */
  manifest: Record<string, string>;
  /** Files in the saved set. */
  fileCount: number;
  /** Objects newly written this save (0 ⇒ fully deduped; the rest were hits). */
  objectsWritten: number;
  /** sha256 over the canonical (sorted) manifest — stable set identity. `''` for the file impl. */
  manifestHash: string;
}

/** Pluggable contract store. File-backed by default; EE injects Postgres/Blob. */
export interface ContractStore {
  /**
   * Snapshot the tree at `sourceDir` (the kind's root the IL writer just
   * populated) for `(ref, kind)`. Idempotent on content.
   */
  saveContracts(ref: RepoRef, kind: ContractKind, sourceDir: string): Promise<SaveContractsResult>;
  /**
   * Materialize `(ref, kind)` into a dir `verify`/`infer` can read, or `null`
   * when nothing was saved. The file impl returns the live repo dir with a
   * no-op cleanup.
   */
  loadContracts(ref: RepoRef, kind: ContractKind): Promise<MaterializedDir | null>;
  /** Cheap existence probe (the gate uses it: "is this head already saved?"). */
  hasContracts(ref: RepoRef, kind: ContractKind): Promise<boolean>;
  /**
   * Posix-relative paths of every `.tc` in the repo's CURRENT set, for the
   * dashboard contract browser. Keyed by repo only (the impl picks the current
   * set — the live tree for the file impl, the latest stored set for EE).
   */
  listContractFiles(repoKey: string, kind: ContractKind): Promise<string[]>;
  /** One `.tc` file's content (by relative path) from the current set, or null. */
  readContractFile(repoKey: string, kind: ContractKind, relPath: string): Promise<string | null>;
  /**
   * Capability flag: `true` when `loadContracts` returns the live repo tree
   * (file impl) — callers must treat `dir` as read-only and generate in place;
   * `false` (EE) means callers generate into a temp workspace and ingest.
   */
  readonly materializesInPlace: boolean;
}

// ---------------------------------------------------------------------------
// Layout (file impl)
// ---------------------------------------------------------------------------

const KIND_REL: Record<ContractKind, string[]> = {
  contracts: ['.truecourse', 'contracts'],
  // The inferred tree lives at contracts/_inferred (matches `writeInferred`).
  contracts_inferred: ['.truecourse', 'contracts', '_inferred'],
};

/** Recursively count `.tc` files (no file reads — keeps the OSS path cheap). */
export function countTcFiles(dir: string): number {
  let n = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (e.isDirectory()) n += countTcFiles(path.join(dir, e.name));
    else if (e.isFile() && e.name.endsWith('.tc')) n += 1;
  }
  return n;
}

/** Posix-relative paths of every `.tc` under `dir`; `excludeInferred` skips the top-level `_inferred/`. */
function walkTcRel(dir: string, excludeInferred: boolean): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (excludeInferred && rel === '' && e.name === '_inferred') continue;
        walk(childRel);
      } else if (e.isFile() && e.name.endsWith('.tc')) {
        out.push(childRel);
      }
    }
  };
  walk('');
  return out;
}

/** Resolve `rel` under `root`, returning null if it would escape (traversal guard). */
function safeResolve(root: string, rel: string): string | null {
  const norm = rel.replace(/\\/g, '/');
  if (!norm || norm.includes('\0') || norm.startsWith('/') || /^[a-zA-Z]:/.test(norm)) return null;
  if (norm.split('/').some((s) => s === '..' || s === '.' || s === '')) return null;
  const base = path.resolve(root);
  const dest = path.resolve(base, norm);
  if (dest !== base && !dest.startsWith(base + path.sep)) return null;
  return dest;
}

// ---------------------------------------------------------------------------
// File-backed default impl (OSS) — a no-op broker over the repo's own tree.
// The IL writers already wrote `<repo>/.truecourse/contracts`; verify reads it.
// ---------------------------------------------------------------------------

class FileContractStore implements ContractStore {
  readonly materializesInPlace = true;

  async saveContracts(
    ref: RepoRef,
    kind: ContractKind,
    _sourceDir: string,
  ): Promise<SaveContractsResult> {
    // No copy: the IL writer already wrote into the repo tree (`sourceDir` IS
    // that tree). Report a trivial result; never hash (OSS stays free).
    const dir = path.join(ref.repoKey, ...KIND_REL[kind]);
    return { manifest: {}, fileCount: countTcFiles(dir), objectsWritten: 0, manifestHash: '' };
  }

  async loadContracts(ref: RepoRef, kind: ContractKind): Promise<MaterializedDir | null> {
    const dir = path.join(ref.repoKey, ...KIND_REL[kind]);
    if (!fs.existsSync(dir)) return null;
    return { dir, cleanup: async () => {} }; // live repo dir — NEVER delete
  }

  async hasContracts(ref: RepoRef, kind: ContractKind): Promise<boolean> {
    return fs.existsSync(path.join(ref.repoKey, ...KIND_REL[kind]));
  }

  async listContractFiles(repoKey: string, kind: ContractKind): Promise<string[]> {
    return walkTcRel(path.join(repoKey, ...KIND_REL[kind]), kind === 'contracts');
  }

  async readContractFile(
    repoKey: string,
    kind: ContractKind,
    relPath: string,
  ): Promise<string | null> {
    const dest = safeResolve(path.join(repoKey, ...KIND_REL[kind]), relPath);
    if (!dest || !fs.existsSync(dest) || !fs.statSync(dest).isFile()) return null;
    return fs.readFileSync(dest, 'utf-8');
  }
}

// ---------------------------------------------------------------------------
// Active store registry + delegators (mirrors verify-store.ts).
// ---------------------------------------------------------------------------

let active: ContractStore = new FileContractStore();

/** The active contract store (file-backed unless EE installed a Postgres/Blob one). */
export function getContractStore(): ContractStore {
  return active;
}
/** Install a contract store (e.g. the enterprise Postgres/Blob impl). */
export function setContractStore(store: ContractStore): void {
  active = store;
}
/** Restore the file-backed default (tests). */
export function resetContractStore(): void {
  active = new FileContractStore();
}

export const saveContracts = (
  ref: RepoRef,
  kind: ContractKind,
  sourceDir: string,
): Promise<SaveContractsResult> => active.saveContracts(ref, kind, sourceDir);
export const loadContracts = (
  ref: RepoRef,
  kind: ContractKind,
): Promise<MaterializedDir | null> => active.loadContracts(ref, kind);
export const hasContracts = (ref: RepoRef, kind: ContractKind): Promise<boolean> =>
  active.hasContracts(ref, kind);
export const listContractFiles = (repoKey: string, kind: ContractKind): Promise<string[]> =>
  active.listContractFiles(repoKey, kind);
export const readContractFile = (
  repoKey: string,
  kind: ContractKind,
  relPath: string,
): Promise<string | null> => active.readContractFile(repoKey, kind, relPath);
/** Whether the active store materializes the live repo tree in place (file) or a temp dir (EE). */
export const contractsMaterializeInPlace = (): boolean => active.materializesInPlace;
