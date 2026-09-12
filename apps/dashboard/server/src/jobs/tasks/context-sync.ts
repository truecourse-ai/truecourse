/**
 * `context.sync` — one refresh of ONE workspace source, as a background job.
 *
 * Adding a source enqueues it, Sync now enqueues it, a push to a repository's
 * default branch enqueues its Repository source's, and the daily sweep enqueues
 * every site's. Single-flight per source (the queue key is the source id), so a
 * push storm, a double click and the sweep collapse into one run.
 *
 * The job is the only writer: the driver reads the origin and hands back the
 * current document set with the added / changed / removed / unchanged diff, and
 * this body stores the bodies, replaces the source's ledger slice, writes the
 * sync record and moves the source's status — `synced`, or `failed` carrying
 * the reason verbatim. A `paused` source is skipped without touching anything:
 * pausing is the user's own stop, and every trigger honors it.
 *
 * A document whose content did not change keeps the stamp it already had, so a
 * re-fetch never reads as an edit.
 *
 * The settle hook is where onboarding continues: a repository's FIRST sync
 * starts its Test setup whatever it reconciled (setup needs no documents), and
 * a sync that reconciled something chains the workspace Document scan.
 */

import { log } from '@truecourse/core/lib/logger';
import type { JobDefinition, JobPayload } from '@truecourse/jobs';
import {
  getContextSource,
  listContextDocuments,
  recordContextSync,
  updateContextSource,
  writeContextDocuments,
  type ContextDocumentWrite,
} from '@truecourse/core/lib/context-store';
import { ContextKindUnsupportedError, contextDrivers } from '@truecourse/core/services/context';
import type { ContextLedgerEntry } from '@truecourse/core/services/context';
import type { ContextSourceStatus } from '@truecourse/shared';
import { contextDriverDeps, emitContextChanged } from '../../services/context.service.js';

export const CONTEXT_SYNC_TASK = 'context.sync';

/** What asked for this sync. Carried for the log line and the notification data. */
export type ContextSyncSource = 'add' | 'manual' | 'push' | 'schedule';

/** What an enqueue is asked for — the payload minus the row the queue creates. */
export interface ContextSyncJobRequest {
  workspaceOrgId: string;
  sourceId: string;
  source: ContextSyncSource;
}

export type ContextSyncJobPayload = ContextSyncJobRequest & JobPayload;

/** What the job returns on the row (and what a chain could key off). */
export interface ContextSyncJobResult {
  sourceId: string;
  /** 'synced' when the driver ran; 'paused' / 'missing' when it deliberately did not. */
  outcome: 'synced' | 'paused' | 'missing';
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
}

export interface ContextSyncTaskDeps {
  /** The drivers the body runs, for one workspace. Production builds them from the server's deps. */
  drivers?: (workspaceOrgId: string) => ReturnType<typeof contextDrivers>;
  /** The clock the sync record is stamped with. */
  now?: () => Date;
  /**
   * Chain the workspace Document scan when this sync RECONCILED something. A
   * sync that changed no document leaves the corpus current, so the chain is
   * the settle hook's own judgment, not an unconditional follow-on.
   */
  chainScan?: (request: ContextSyncJobRequest, result: ContextSyncJobResult) => Promise<void>;
  /**
   * Start the repository's Test setup after its FIRST sync — whatever that sync
   * reconciled, zero included. A connected repository always onboards: setup
   * derives its recipe, dependencies and interfaces from the code and needs no
   * documents at all, so a repository whose markdown is empty must not be left
   * waiting for a scan that will never be chained. The mount decides whether
   * this sync is that one (a repository source, added) and whether the
   * repository is already set up.
   */
  chainSetup?: (request: ContextSyncJobRequest, result: ContextSyncJobResult) => Promise<void>;
}

const NOTHING: Omit<ContextSyncJobResult, 'sourceId' | 'outcome'> = {
  added: 0,
  changed: 0,
  removed: 0,
  unchanged: 0,
};

export function createContextSyncTask(
  deps: ContextSyncTaskDeps = {},
): JobDefinition<ContextSyncJobPayload> {
  const drivers = deps.drivers ?? ((org: string) => contextDrivers(contextDriverDeps(org)));
  const now = deps.now ?? (() => new Date());

  return {
    type: CONTEXT_SYNC_TASK,
    title: 'Syncing context source',
    steps: [
      { key: 'read', label: 'Reading the source' },
      { key: 'store', label: 'Storing documents' },
    ],
    org: (payload) => payload.workspaceOrgId,

    async run(ctx) {
      const { workspaceOrgId: org, sourceId } = ctx.payload;
      const source = await getContextSource(org, sourceId);
      if (!source) {
        // Removed while this job sat in the queue. Nothing failed — there is
        // simply nothing left to sync, and nobody to tell.
        log.info(`[context] ${sourceId} is gone — nothing to sync`);
        return { result: { sourceId, outcome: 'missing', ...NOTHING }, notification: null };
      }
      if (source.status === 'paused') {
        log.info(`[context] ${sourceId} is paused — skipping the sync`);
        return { result: { sourceId, outcome: 'paused', ...NOTHING }, notification: null };
      }

      const driver = drivers(org).get(source.kind);
      if (!driver) throw new ContextKindUnsupportedError(source.kind);

      const previous = await listContextDocuments(org, sourceId);
      const ledger: ContextLedgerEntry[] = previous.map((doc) => ({
        docId: doc.docId,
        docPath: doc.docPath,
        contentHash: doc.contentHash,
      }));
      const priorStatus = source.status;
      await updateContextSource(org, sourceId, { status: 'syncing', statusNote: null });
      await emitContextChanged(org, { change: 'sources', sourceId });

      let result;
      try {
        await ctx.phase('read');
        result = await driver.sync(source.config, ledger, {
          ...(ctx.signal ? { signal: ctx.signal } : {}),
          onProgress: (done, total) => {
            void ctx.detail('read', `${done}/${total}`);
          },
        });
      } catch (err) {
        // A stop the user asked for leaves the source as it was; a real failure
        // records why, so the Context page says it without reading a log.
        await settleFailure(org, sourceId, priorStatus, ctx.signal?.aborted === true, err);
        throw err;
      }

      await ctx.phase('store', `${result.documents.length} document(s)`);
      const at = now().toISOString();
      const stamps = new Map(previous.map((doc) => [doc.docId, doc.updatedAt]));
      const changedIds = new Set([...result.added, ...result.changed]);
      const documents: ContextDocumentWrite[] = result.documents.map((doc) => ({
        docId: doc.docId,
        docPath: doc.docPath,
        title: doc.title,
        url: doc.url,
        contentHash: doc.contentHash,
        body: doc.body,
        // Only a document that actually changed takes a new stamp.
        updatedAt: changedIds.has(doc.docId) ? doc.updatedAt : (stamps.get(doc.docId) ?? doc.updatedAt),
      }));
      await writeContextDocuments(org, sourceId, { documents, removed: result.removed });
      await recordContextSync(org, {
        sourceId,
        at,
        parentAt: source.lastSyncAt,
        added: result.added.length,
        changed: result.changed.length,
        removed: result.removed.length,
        unchanged: result.unchanged.length,
      });
      await updateContextSource(org, sourceId, {
        status: 'synced',
        statusNote: null,
        lastSyncAt: at,
        // A site renames itself by renaming its llms.txt H1; a repository's
        // title is its own name either way.
        ...(result.title ? { title: result.title } : {}),
      });

      await emitContextChanged(org, { change: 'documents', sourceId });

      const counts = {
        added: result.added.length,
        changed: result.changed.length,
        removed: result.removed.length,
        unchanged: result.unchanged.length,
      };
      return {
        result: { sourceId, outcome: 'synced', ...counts } satisfies ContextSyncJobResult,
        notification: {
          level: 'success',
          title: 'Source synced',
          body: `${summary(counts)}.`,
          data: { sourceId, sourceTitle: result.title ?? source.title, ...counts },
        },
      };
    },

    // The payload is all a failure is handed, and reading the source back to
    // name it would be a store round trip on the way out: the row carries the
    // source id, and the page reads its title from the source itself.
    onError: (err, payload) => ({
      level: 'error',
      title: 'Source sync failed',
      body: err.message,
      data: { sourceId: payload.sourceId },
    }),

    async onSettled(ctx, outcome, result) {
      // A sync that reconciled something is what makes the workspace corpus
      // stale, so the scan follows it — one motion, exactly as a repository's
      // scan used to chain its setup. A failed or cancelled sync chains nothing.
      if (outcome !== 'succeeded') return;
      const settled = result as ContextSyncJobResult | undefined;
      if (!settled || settled.outcome !== 'synced') return;
      // The repository's own onboarding first: it does not wait on documents,
      // and starting it here means the ripple below finds it already working
      // rather than racing it.
      try {
        await deps.chainSetup?.(ctx.payload, settled);
      } catch (err) {
        log.warn(
          `[context] could not start ${ctx.payload.sourceId}'s test setup: ${(err as Error).message}`,
        );
      }
      if (!deps.chainScan) return;
      try {
        await deps.chainScan(ctx.payload, settled);
      } catch (err) {
        // The sync already succeeded; the scan can be started by hand.
        log.warn(
          `[context] could not chain the document scan after ${ctx.payload.sourceId}: ${(err as Error).message}`,
        );
      }
    },
  };

  /** Put the source back where the failure (or the stop) leaves it. */
  async function settleFailure(
    org: string,
    sourceId: string,
    priorStatus: ContextSourceStatus,
    aborted: boolean,
    err: unknown,
  ): Promise<void> {
    await updateContextSource(
      org,
      sourceId,
      aborted
        ? { status: priorStatus, statusNote: null }
        : { status: 'failed', statusNote: (err as Error).message },
    );
    await emitContextChanged(org, { change: 'sources', sourceId });
  }
}

/** "3 added, 1 changed, 2 removed": the counts that are not zero, or "No changes". */
function summary(counts: { added: number; changed: number; removed: number }): string {
  const parts: string[] = [];
  if (counts.added > 0) parts.push(`${counts.added} added`);
  if (counts.changed > 0) parts.push(`${counts.changed} changed`);
  if (counts.removed > 0) parts.push(`${counts.removed} removed`);
  return parts.length > 0 ? parts.join(', ') : 'No changes';
}

/** The single-flight key: one active sync per (workspace, source). */
export const contextSyncJobKey = (sourceId: string): string => `${CONTEXT_SYNC_TASK}:${sourceId}`;
