/**
 * The SOURCE DRIVER seam — the one thing a kind of source has to implement, and
 * the only place in the pipeline that talks to an origin.
 *
 * Two calls, and nothing else:
 *   - `check(config)` reads what the scope WOULD yield (a count and the first
 *     titles) and stores nothing. It is what the add dialog's Check runs,
 *     before a source exists.
 *   - `sync(config, ledger)` reads the scope for real and reconciles it against
 *     the ledger rows the workspace already holds, handing back the whole
 *     current document set with bodies plus the added / changed / removed /
 *     unchanged diff. The caller stores; the driver never does.
 *
 * A driver holds no store reference and no workspace identity on purpose: the
 * same driver serves the add preview (no source yet), the sync job and a test.
 */

import type {
  ContextSkip,
  ContextSourceCheck,
  ContextSourceConfig,
  ContextSourceKind,
} from '@truecourse/shared';

/** One document a driver read, body included. */
export interface ContextDriverDocument {
  /** The page URL for a site, the repo-relative path for a repository. */
  docId: string;
  /** The ref's path half (`context/<sourceId>/<docPath>`). */
  docPath: string;
  title: string;
  url: string | null;
  /** sha256 hex of `body`. */
  contentHash: string;
  body: string;
  /**
   * When the document last changed at its source, as far as the driver can
   * know: a repository's last commit for the file; a site's fetch time (a page
   * carries no timestamp of its own). The caller keeps the STORED stamp for a
   * document whose content did not change, so a re-fetch never fakes an edit.
   */
  updatedAt: string;
}

/** What the workspace already holds for a source — the diff's other side. */
export interface ContextLedgerEntry {
  docId: string;
  docPath: string;
  contentHash: string;
}

/** One refresh, as the driver read it. `added`/`changed`/… are `docId`s. */
export interface ContextSyncResult {
  /** The title the origin gives itself now (a site's llms.txt H1). */
  title?: string;
  /** Every document the scope yields RIGHT NOW, with bodies. */
  documents: ContextDriverDocument[];
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: string[];
  /** What the scope listed but yielded nothing for. */
  skipped: ContextSkip[];
}

/** What a driver call may be given: a stop signal and a progress tap. */
export interface ContextDriverOptions {
  signal?: AbortSignal;
  /** Called as documents settle, so a job can detail its step. */
  onProgress?: (done: number, total: number) => void;
}

export interface ContextSourceDriver {
  kind: ContextSourceKind;
  check(config: ContextSourceConfig, opts?: ContextDriverOptions): Promise<ContextSourceCheck>;
  sync(
    config: ContextSourceConfig,
    ledger: readonly ContextLedgerEntry[],
    opts?: ContextDriverOptions,
  ): Promise<ContextSyncResult>;
}

/** A working tree a repository driver reads, and how to give it back. */
export interface ContextWorkTree {
  dir: string;
  dispose(): void | Promise<void>;
}

/**
 * How a repository source gets a checkout of its branch. The hosted server
 * installs the run-clone provider; a test hands back a fixture directory.
 */
export type ContextWorkTreeProvider = (repoFullName: string) => Promise<ContextWorkTree>;

/** The configuration a source carries is unusable (a caller's bug or bad input). */
export class ContextConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextConfigError';
  }
}
