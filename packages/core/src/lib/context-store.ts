/**
 * The workspace CONTEXT store — the sources a workspace has, the documents they
 * yielded, the syncs that reconciled them, and which repositories read which
 * source.
 *
 * One seam, ONE implementation: the hosted Postgres store
 * (`@truecourse/data-store`), installed at boot. File mode (the CLI) is a
 * one-repository world with a tree of its own and no workspace to speak of, so
 * the default store throws — nothing in the CLI may reach through here, and a
 * call that does is a bug that says so rather than inventing an empty workspace.
 *
 * Bodies are content-addressed: the ledger row carries the sha256 HEX of the
 * body and the store keeps the body once per workspace under that hash. Reading
 * a document is therefore two hops — the ledger row for the ref, then the body
 * for its hash — and `readDocByRef` is the one that does both.
 */

import type {
  ContextBinding,
  ContextDocument,
  ContextSource,
  ContextSourceConfig,
  ContextSourceKind,
  ContextSourceStatus,
  ContextSyncRecord,
} from '@truecourse/shared';
import { parseContextDocRef } from './context-ref.js';

/** What a caller supplies to create a source. The store stamps the timestamps. */
export interface ContextSourceInput {
  id: string;
  kind: ContextSourceKind;
  title: string;
  config: ContextSourceConfig;
  status?: ContextSourceStatus;
  statusNote?: string | null;
}

/** What a caller may change on a source. Omitted fields are left alone. */
export interface ContextSourcePatch {
  title?: string;
  config?: ContextSourceConfig;
  status?: ContextSourceStatus;
  /** Pass null to clear the note; omit to leave it. */
  statusNote?: string | null;
  lastSyncAt?: string | null;
}

/** One document to write into the ledger, body included. */
export interface ContextDocumentWrite {
  docId: string;
  docPath: string;
  title: string;
  url: string | null;
  contentHash: string;
  updatedAt: string;
  /** The body, stored once per workspace under `contentHash`. */
  body: string;
}

/** One source's whole ledger after a sync: what it holds now, and what went. */
export interface ContextLedgerWrite {
  documents: ContextDocumentWrite[];
  /** `docId`s the sync no longer yields — their rows go. */
  removed: string[];
}

/** A source already exists for this scope (a site URL, a repository). */
export class ContextSourceExistsError extends Error {
  constructor(
    message: string,
    readonly existingId: string,
  ) {
    super(message);
    this.name = 'ContextSourceExistsError';
  }
}

export interface ContextStore {
  listSources(org: string): Promise<ContextSource[]>;
  getSource(org: string, sourceId: string): Promise<ContextSource | null>;
  createSource(org: string, input: ContextSourceInput): Promise<ContextSource>;
  /** Returns the updated source, or null when it no longer exists. */
  updateSource(org: string, sourceId: string, patch: ContextSourcePatch): Promise<ContextSource | null>;
  /** Drop the source, its documents, its syncs and every binding to it. */
  removeSource(org: string, sourceId: string): Promise<void>;

  /** The sync record of one refresh. */
  recordSync(org: string, record: ContextSyncRecord): Promise<void>;
  listSyncs(org: string, sourceId: string, limit?: number): Promise<ContextSyncRecord[]>;

  /** The ledger: every document of one source, or of the whole workspace. */
  listDocuments(org: string, sourceId?: string): Promise<ContextDocument[]>;
  /** Replace one source's ledger slice and store the bodies it names. */
  writeDocuments(org: string, sourceId: string, write: ContextLedgerWrite): Promise<void>;
  /** One body by its content hash, or null when the workspace does not hold it. */
  readBody(org: string, contentHash: string): Promise<string | null>;

  /** The source ids one repository reads. */
  bindings(org: string, repoFullName: string): Promise<string[]>;
  /** Replace the set of sources one repository reads. */
  setBindings(org: string, repoFullName: string, sourceIds: string[]): Promise<void>;
  /** Every `owner/repo` that reads this source. */
  reposForSource(org: string, sourceId: string): Promise<string[]>;
  /** Every binding of the workspace, for composing the listing in one read. */
  listBindings(org: string): Promise<ContextBinding[]>;

  /**
   * When the workspace's Context last changed in a way the corpus must see: a
   * sync that added, changed or removed a document, a link made or dropped, a
   * source removed. Compared against the workspace corpus's own stamp, it says
   * whether the scan has seen the current context. Null when nothing has ever
   * changed. ISO-8601 with a `Z`, so the comparison is a string comparison.
   */
  changedAt(org: string): Promise<string | null>;
}

/** Every call a CLI checkout could make here is a bug — say so, don't invent. */
const FILE_MODE = 'The workspace context store is not available in file mode.';

class UnavailableContextStore implements ContextStore {
  private fail(): never {
    throw new Error(FILE_MODE);
  }
  listSources(): Promise<ContextSource[]> {
    this.fail();
  }
  getSource(): Promise<ContextSource | null> {
    this.fail();
  }
  createSource(): Promise<ContextSource> {
    this.fail();
  }
  updateSource(): Promise<ContextSource | null> {
    this.fail();
  }
  removeSource(): Promise<void> {
    this.fail();
  }
  recordSync(): Promise<void> {
    this.fail();
  }
  listSyncs(): Promise<ContextSyncRecord[]> {
    this.fail();
  }
  listDocuments(): Promise<ContextDocument[]> {
    this.fail();
  }
  writeDocuments(): Promise<void> {
    this.fail();
  }
  readBody(): Promise<string | null> {
    this.fail();
  }
  bindings(): Promise<string[]> {
    this.fail();
  }
  setBindings(): Promise<void> {
    this.fail();
  }
  reposForSource(): Promise<string[]> {
    this.fail();
  }
  listBindings(): Promise<ContextBinding[]> {
    this.fail();
  }
  changedAt(): Promise<string | null> {
    this.fail();
  }
}

const unavailable = new UnavailableContextStore();
let active: ContextStore = unavailable;

export function setContextStore(store: ContextStore): void {
  active = store;
}

export function resetContextStore(): void {
  active = unavailable;
}

/** Whether a workspace context store is installed (hosted) or not (file mode). */
export function contextStoreInstalled(): boolean {
  return active !== unavailable;
}

export const listContextSources = (org: string): Promise<ContextSource[]> => active.listSources(org);

export const getContextSource = (org: string, sourceId: string): Promise<ContextSource | null> =>
  active.getSource(org, sourceId);

export const createContextSource = (org: string, input: ContextSourceInput): Promise<ContextSource> =>
  active.createSource(org, input);

export const updateContextSource = (
  org: string,
  sourceId: string,
  patch: ContextSourcePatch,
): Promise<ContextSource | null> => active.updateSource(org, sourceId, patch);

export const removeContextSource = (org: string, sourceId: string): Promise<void> =>
  active.removeSource(org, sourceId);

export const recordContextSync = (org: string, record: ContextSyncRecord): Promise<void> =>
  active.recordSync(org, record);

export const listContextSyncs = (
  org: string,
  sourceId: string,
  limit?: number,
): Promise<ContextSyncRecord[]> => active.listSyncs(org, sourceId, limit);

export const listContextDocuments = (org: string, sourceId?: string): Promise<ContextDocument[]> =>
  active.listDocuments(org, sourceId);

export const writeContextDocuments = (
  org: string,
  sourceId: string,
  write: ContextLedgerWrite,
): Promise<void> => active.writeDocuments(org, sourceId, write);

export const readContextBody = (org: string, contentHash: string): Promise<string | null> =>
  active.readBody(org, contentHash);

export const contextBindings = (org: string, repoFullName: string): Promise<string[]> =>
  active.bindings(org, repoFullName);

export const setContextBindings = (
  org: string,
  repoFullName: string,
  sourceIds: string[],
): Promise<void> => active.setBindings(org, repoFullName, sourceIds);

export const contextReposForSource = (org: string, sourceId: string): Promise<string[]> =>
  active.reposForSource(org, sourceId);

export const listContextBindings = (org: string): Promise<ContextBinding[]> =>
  active.listBindings(org);

export const contextChangedAt = (org: string): Promise<string | null> => active.changedAt(org);

/**
 * One document's body by its corpus ref (`context/<sourceId>/<docPath>`), or
 * null when the ref is not a context ref, names no stored document, or the
 * workspace no longer holds its body.
 */
export async function readContextDocByRef(org: string, ref: string): Promise<string | null> {
  const parsed = parseContextDocRef(ref);
  if (!parsed) return null;
  const docs = await active.listDocuments(org, parsed.sourceId);
  const doc = docs.find((entry) => entry.docPath === parsed.docPath);
  if (!doc) return null;
  return active.readBody(org, doc.contentHash);
}
