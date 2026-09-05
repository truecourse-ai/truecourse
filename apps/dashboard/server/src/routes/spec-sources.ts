/**
 * Spec WEB-SOURCE routes — llms.txt documentation sites registered as spec docs
 * (the dashboard surface for `truecourse spec source`). Thin adapters over the
 * `@truecourse/core` source commands, so the CLI and the dashboard share one
 * confirm gate, one progress wiring, and one snapshot lifecycle.
 *
 *   GET    /:id/spec/sources                    the registry: title, page count, last fetch, skipped
 *   GET    /:id/spec/sources/:sourceId          one source + the pages it snapshotted
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
 * The engine works on files. A working tree is edited in place; a hosted repo
 * (no checkout) runs every write over a scratch tree of its stored sources and
 * stores what the engine left there (`withSpecSourcesTree`), while the reads
 * come straight from the store.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  previewSource,
  sourceDocRef,
  InvalidSourceUrlError,
  LlmsTxtFetchError,
  SourceExistsError,
  SourceNotFoundError,
  SourcesFileError,
  type SourceSkip,
  type SpecSource,
} from '@truecourse/spec-consolidator';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import { readSpecSourcesRegistry, withSpecSourcesTree } from '@truecourse/core/lib/spec-sources';
import {
  addSpecSourceInProcess,
  refreshSpecSourcesInProcess,
  removeSpecSourceInProcess,
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

/** One snapshotted page: what it is called, where it came from, and the corpus
 *  ref the doc viewer opens it by. */
interface SpecSourceDocView {
  ref: string;
  path: string;
  title: string;
  url: string;
}

/** ONE source with its per-page manifest — read on demand by the detail pane,
 *  which lists the pages; the registry listing stays lean. */
interface SpecSourceDetailView extends SpecSourceView {
  docs: SpecSourceDocView[];
}

function sourceDetailView(source: SpecSource): SpecSourceDetailView {
  return {
    ...sourceView(source),
    docs: source.docs.map((doc) => ({
      ref: sourceDocRef(source.id, doc.path),
      path: doc.path,
      title: doc.title,
      url: doc.url,
    })),
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

/** The registered sources, through the seam: the tree's registry or the stored row. */
async function listSources(repoKey: string): Promise<SpecSource[]> {
  return (await readSpecSourcesRegistry(repoKey)).sources;
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
async function sourceErrorMessage(repoPath: string, err: unknown): Promise<string> {
  if (err instanceof SourceNotFoundError) {
    const known = (await safeList(repoPath)).map((source) => source.id);
    return known.length === 0
      ? `${err.message} — nothing is registered yet.`
      : `${err.message}. Registered: ${known.join(', ')}.`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** The registry for an error message must never mask the error it explains. */
async function safeList(repoPath: string): Promise<SpecSource[]> {
  try {
    return await listSources(repoPath);
  } catch {
    return [];
  }
}

async function respondSourceError(
  repoPath: string,
  res: Response,
  next: NextFunction,
  err: unknown,
): Promise<void> {
  const status = sourceErrorStatus(err);
  if (status === null) {
    next(err);
    return;
  }
  res.status(status).json({ error: await sourceErrorMessage(repoPath, err) });
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
): Promise<void> {
  emitSpecProgress(repoId, {
    step: 'error',
    percent: 100,
    detail: err instanceof Error ? err.message : String(err),
    kind: 'sources',
  });
  return respondSourceError(repoPath, res, next, err);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

router.get('/:id/spec/sources', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    res.json({ sources: (await listSources(repo.path)).map(sourceView) });
  } catch (e) {
    await respondSourceError('', res, next, e);
  }
});

// ONE source, with the pages it snapshotted. The listing above deliberately drops
// that array (hundreds of entries per site, on every sidebar mount); the detail
// pane renders the pages, so it reads them here — one source, when it is opened.
router.get('/:id/spec/sources/:sourceId', async (req: Request, res: Response, next: NextFunction) => {
  let repoPath = '';
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    repoPath = repo.path;
    const sourceId = req.params.sourceId as string;
    const source = (await listSources(repo.path)).find((entry) => entry.id === sourceId);
    if (!source) throw new SourceNotFoundError(sourceId);
    res.json({ source: sourceDetailView(source) });
  } catch (e) {
    await respondSourceError(repoPath, res, next, e);
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
    const url = readUrl(req, res);
    if (url === null) return;
    res.json(await previewSource(url));
  } catch (e) {
    await respondSourceError(repoPath, res, next, e);
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
    const url = readUrl(req, res);
    if (url === null) return;
    const body = (req.body ?? {}) as { id?: unknown };
    const id = typeof body.id === 'string' && body.id.trim() !== '' ? body.id.trim() : undefined;

    const tracker = createSocketSpecTracker(repoId, SOURCE_ADD_STEPS.map((s) => ({ ...s })), 'sources');
    started = true;
    const result = await withSpecSourcesTree(repo.path, (tree) =>
      addSpecSourceInProcess(tree, url, {
        tracker,
        id,
        // The client already confirmed against the preview above, so the engine's
        // gate is a pass-through here — it never blocks an HTTP request.
        onConfirm: () => true,
      }),
    );
    emitSpecComplete(repoId, 'sources');
    res.json({
      source: sourceView(result.source),
      written: result.written,
      skipped: result.skipped,
    });
  } catch (e) {
    if (started) await failRun(repoId, repoPath, res, next, e);
    else await respondSourceError(repoPath, res, next, e);
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
    // An unknown id is a 404 before any fetch — and before a scratch tree exists.
    const registered = await listSources(repo.path);
    const targets = sourceId ? registered.filter((source) => source.id === sourceId) : registered;
    if (sourceId && targets.length === 0) throw new SourceNotFoundError(sourceId);
    if (targets.length === 0) {
      res.json({ results: [] });
      return;
    }
    const tracker = createSocketSpecTracker(repoId, sourceRefreshSteps(targets), 'sources');
    started = true;
    const results = await withSpecSourcesTree(repo.path, (tree) =>
      refreshSpecSourcesInProcess(tree, { sourceId, tracker }),
    );
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
    if (started) await failRun(repoId, repoPath, res, next, e);
    else await respondSourceError(repoPath, res, next, e);
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
      const sourceId = req.params.sourceId as string;
      const removed = await withSpecSourcesTree(repo.path, (tree) =>
        removeSpecSourceInProcess(tree, sourceId),
      );
      emitSpecComplete(repoId, 'sources');
      res.json({ removed: sourceView(removed) });
    } catch (e) {
      await respondSourceError(repoPath, res, next, e);
    }
  },
);

export default router;
