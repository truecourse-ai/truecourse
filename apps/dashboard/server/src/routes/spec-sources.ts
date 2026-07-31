/**
 * Spec WEB-SOURCE routes — llms.txt documentation sites registered as spec docs
 * (the dashboard surface for `truecourse spec source`). Thin adapters over the
 * `@truecourse/core` source commands, so the CLI and the dashboard share one
 * confirm gate, one progress wiring, and one snapshot lifecycle.
 *
 *   GET    /:id/spec/sources                    the registry: title, page count, last fetch, skipped
 *   POST   /:id/spec/sources/preview            what an add WOULD fetch — reads llms.txt, writes nothing
 *   POST   /:id/spec/sources                    register + snapshot every markdown page
 *   POST   /:id/spec/sources/refresh            refetch every registered source
 *   POST   /:id/spec/sources/:sourceId/refresh  refetch one
 *   DELETE /:id/spec/sources/:sourceId          drop the snapshot + the registry entry
 *
 * No LLM call happens here — add/refresh are pure fetching, so there is no cost
 * estimate. The pages they materialize are priced by the next `spec scan`.
 * Progress streams over the existing `spec:progress` channel and each write ends
 * with `spec:complete { kind: 'sources' }`, which lights the Rescan dot (the
 * staleness probe watches `specs/sources.json` + the snapshot tree).
 *
 * Concurrency: like `/spec/corpus/scan`, no server-side lock — the client
 * disables its buttons for the duration of the request. The engine itself is
 * safe under overlap (the registry is rewritten atomically and a refresh only
 * deletes files it names).
 *
 * Working tree only: the snapshot is real files under the repo's `.truecourse/`,
 * which hosted EE (no checkout) does not have — those requests get a 501, the
 * same shape the guard externals write uses.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  previewSource,
  InvalidSourceUrlError,
  LlmsTxtFetchError,
  SourceExistsError,
  SourceNotFoundError,
  SourcesFileError,
  type SourceSkip,
  type SpecSource,
} from '@truecourse/spec-consolidator';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import { specsMaterializeInPlace } from '@truecourse/core/lib/spec-store';
import {
  addSpecSourceInProcess,
  listSpecSourcesInProcess,
  refreshSpecSourcesInProcess,
  removeSpecSourceInProcess,
  resolveSpecSources,
  sourceRefreshSteps,
  SOURCE_ADD_STEPS,
} from '@truecourse/core/commands/spec-sources';
import {
  createSocketSpecTracker,
  emitSpecComplete,
  emitSpecProgress,
} from '../socket/handlers.js';

const router: Router = Router();

/** One registered source, as the dashboard reads it: the registry entry minus
 *  the per-page array (hundreds of entries the list never renders). */
interface SpecSourceView {
  id: string;
  title: string;
  llmsTxtUrl: string;
  fetchedAt: string;
  docCount: number;
  skipped: SourceSkip[];
}

function sourceView(source: SpecSource): SpecSourceView {
  return {
    id: source.id,
    title: source.title,
    llmsTxtUrl: source.llmsTxtUrl,
    fetchedAt: source.fetchedAt,
    docCount: source.docs.length,
    skipped: source.skipped,
  };
}

/** A refresh's reconciliation. `unchanged` is a COUNT — the paths would be the
 *  whole site on a run where nothing moved, and nothing renders them. */
interface SpecSourceRefreshView {
  source: SpecSourceView;
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: number;
  skipped: SourceSkip[];
}

/**
 * Snapshots are real files in the repo's working tree, so a hosted repo (no
 * checkout) cannot host a source. Refuse with the same 501 shape the guard
 * externals write uses rather than silently reading an empty registry.
 */
function requireLocalTree(res: Response): boolean {
  if (specsMaterializeInPlace()) return true;
  res.status(501).json({ error: 'Web spec sources require a local working tree.' });
  return false;
}

/**
 * The engine's typed failures are already user-facing, so they travel verbatim
 * as a clean 4xx instead of a 500 through the error handler. Anything else is a
 * real bug and goes to `next()`.
 */
function sourceErrorStatus(err: unknown): number | null {
  // An unreadable llms.txt is the user's URL to fix (wrong site, not an llms.txt
  // deployment), not an upstream outage we can act on — same 4xx as a malformed one.
  if (err instanceof InvalidSourceUrlError || err instanceof LlmsTxtFetchError) return 400;
  if (err instanceof SourceNotFoundError) return 404;
  if (err instanceof SourceExistsError) return 409;
  if (err instanceof SourcesFileError) return 422;
  return null;
}

/** The engine message, plus the registered ids when the id was the problem. */
function sourceErrorMessage(repoPath: string, err: unknown): string {
  if (err instanceof SourceNotFoundError) {
    const known = safeList(repoPath).map((source) => source.id);
    return known.length === 0
      ? `${err.message} — nothing is registered yet.`
      : `${err.message}. Registered: ${known.join(', ')}.`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** The registry for an error message must never mask the error it explains. */
function safeList(repoPath: string): SpecSource[] {
  try {
    return listSpecSourcesInProcess(repoPath);
  } catch {
    return [];
  }
}

function respondSourceError(
  repoPath: string,
  res: Response,
  next: NextFunction,
  err: unknown,
): void {
  const status = sourceErrorStatus(err);
  if (status === null) {
    next(err);
    return;
  }
  res.status(status).json({ error: sourceErrorMessage(repoPath, err) });
}

/**
 * A fetch job that already started failed: close the progress popup's checklist
 * with the reason (the same lifecycle the scan route gives a failed curate),
 * then answer with the typed status.
 */
function failRun(
  repoId: string,
  repoPath: string,
  res: Response,
  next: NextFunction,
  err: unknown,
): void {
  emitSpecProgress(repoId, {
    step: 'error',
    percent: 100,
    detail: err instanceof Error ? err.message : String(err),
  });
  respondSourceError(repoPath, res, next, err);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

router.get('/:id/spec/sources', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    if (!requireLocalTree(res)) return;
    res.json({ sources: listSpecSourcesInProcess(repo.path).map(sourceView) });
  } catch (e) {
    respondSourceError('', res, next, e);
  }
});

// ---------------------------------------------------------------------------
// Preview — the confirm gate's data, before anything is written. The client
// shows it inline ("Found "Strapi Docs" — 214 pages (198 fetchable)") and only
// then POSTs the add.
// ---------------------------------------------------------------------------

router.post('/:id/spec/sources/preview', async (req: Request, res: Response, next: NextFunction) => {
  let repoPath = '';
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    repoPath = repo.path;
    if (!requireLocalTree(res)) return;
    const url = readUrl(req, res);
    if (url === null) return;
    res.json(await previewSource(url));
  } catch (e) {
    respondSourceError(repoPath, res, next, e);
  }
});

/** The `{ url }` body every add/preview takes, or null once a 400 was sent. */
function readUrl(req: Request, res: Response): string | null {
  const body = (req.body ?? {}) as { url?: unknown };
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) {
    res.status(400).json({ error: "Missing url — pass the site's llms.txt URL." });
    return null;
  }
  return url;
}

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------

router.post('/:id/spec/sources', async (req: Request, res: Response, next: NextFunction) => {
  const repoId = req.params.id as string;
  let repoPath = '';
  let started = false;
  try {
    const repo = await resolveProjectForRequest(repoId);
    repoPath = repo.path;
    if (!requireLocalTree(res)) return;
    const url = readUrl(req, res);
    if (url === null) return;
    const body = (req.body ?? {}) as { id?: unknown };
    const id = typeof body.id === 'string' && body.id.trim() !== '' ? body.id.trim() : undefined;

    const tracker = createSocketSpecTracker(repoId, SOURCE_ADD_STEPS.map((s) => ({ ...s })));
    started = true;
    const result = await addSpecSourceInProcess(repo.path, url, {
      tracker,
      id,
      // The client already confirmed against the preview above, so the engine's
      // gate is a pass-through here — it never blocks an HTTP request.
      onConfirm: () => true,
    });
    emitSpecComplete(repoId, 'sources');
    res.json({
      source: sourceView(result.source),
      written: result.written,
      skipped: result.skipped,
    });
  } catch (e) {
    if (started) failRun(repoId, repoPath, res, next, e);
    else respondSourceError(repoPath, res, next, e);
  }
});

// ---------------------------------------------------------------------------
// Refresh — one source, or every registered one. Both land here: a refresh
// declares ONE progress step per source, so N sources render as N checklist
// lines rather than re-activating a shared step.
// ---------------------------------------------------------------------------

async function runRefresh(
  req: Request,
  res: Response,
  next: NextFunction,
  sourceId?: string,
): Promise<void> {
  const repoId = req.params.id as string;
  let repoPath = '';
  let started = false;
  try {
    const repo = await resolveProjectForRequest(repoId);
    repoPath = repo.path;
    if (!requireLocalTree(res)) return;
    // Throws SourceNotFoundError (→ 404) for an unknown id, before any fetch.
    const targets = resolveSpecSources(repo.path, sourceId);
    if (targets.length === 0) {
      res.json({ results: [] });
      return;
    }
    const tracker = createSocketSpecTracker(repoId, sourceRefreshSteps(targets));
    started = true;
    const results = await refreshSpecSourcesInProcess(repo.path, { sourceId, tracker });
    emitSpecComplete(repoId, 'sources');
    res.json({
      results: results.map(
        (result): SpecSourceRefreshView => ({
          source: sourceView(result.source),
          added: result.added,
          changed: result.changed,
          removed: result.removed,
          unchanged: result.unchanged.length,
          skipped: result.skipped,
        }),
      ),
    });
  } catch (e) {
    if (started) failRun(repoId, repoPath, res, next, e);
    else respondSourceError(repoPath, res, next, e);
  }
}

router.post('/:id/spec/sources/refresh', (req: Request, res: Response, next: NextFunction) => {
  void runRefresh(req, res, next);
});

router.post(
  '/:id/spec/sources/:sourceId/refresh',
  (req: Request, res: Response, next: NextFunction) => {
    void runRefresh(req, res, next, req.params.sourceId as string);
  },
);

// ---------------------------------------------------------------------------
// Remove — an instant file delete (no job, no progress), but it does change what
// the next scan sees, so it emits the same completion event the fetches do.
// ---------------------------------------------------------------------------

router.delete(
  '/:id/spec/sources/:sourceId',
  async (req: Request, res: Response, next: NextFunction) => {
    const repoId = req.params.id as string;
    let repoPath = '';
    try {
      const repo = await resolveProjectForRequest(repoId);
      repoPath = repo.path;
      if (!requireLocalTree(res)) return;
      const removed = removeSpecSourceInProcess(repo.path, req.params.sourceId as string);
      emitSpecComplete(repoId, 'sources');
      res.json({ removed: sourceView(removed) });
    } catch (e) {
      respondSourceError(repoPath, res, next, e);
    }
  },
);

export default router;
