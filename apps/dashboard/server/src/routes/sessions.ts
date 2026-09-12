/**
 * Agent-sessions routes — the dashboard read surface over the sessions store
 * (Postgres for dashboard repositories, local files for file-mode callers).
 * Read-only. Dashboard activity runs expose a replayable AI SDK SSE stream;
 * legacy runs use the socket tail (`joinRun` → `session:*` events).
 *
 *   GET /:id/sessions/runs                                    every run record, newest first
 *   GET /:id/sessions/runs/:command/:runId                    one run record (404 if absent)
 *   GET /:id/sessions/runs/:command/:runId/stream             replay + live, ?after=<cursor>
 *   GET /:id/sessions/runs/:command/:runId/activity           one history page, ?after=&limit=
 *   GET /:id/sessions/runs/:command/:runId/transcript/:sessionId
 *       one session's transcript events; ?since=<seq> returns only events past
 *       that cursor (the client's catch-up read after a socket subscribe)
 *
 * The workspace router (`createWorkspaceSessionsRouter`, mounted at
 * /api/sessions) is the same surface across every repository the caller's
 * workspace connected:
 *
 *   GET /runs         ?repo=&kind=&status=&limit=&before=, newest first
 *   GET /runs/:runId  one run, whichever repository holds it
 *
 * Every serialized record goes through `toPublicRunRecord` — `endpoint` holds
 * the session-API token and MUST never reach a browser.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createUIMessageStreamResponse } from 'ai';
import { readActivityProgress } from '@truecourse/core/lib/activity-journal';
import { createActivityStream } from '../services/activity-stream.service.js';
import { RunStatusSchema, SessionCommandSchema } from '@truecourse/agent-loop';
import { createAppError } from '@truecourse/core/lib/errors';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import { readRegistry, type RegistryEntry } from '@truecourse/core/config/registry';
import {
  SessionRunNotFoundError,
  listStoredSessionRuns,
  listStoredSessionRunsForRepos,
  openStoredSessionRun,
  readStoredActivityPage,
  readStoredTranscriptPage,
  sessionRunCursor,
  parseSessionRunCursor,
  toPublicRunRecord,
  validateStoredActivityCursor,
  readStoredTranscript,
  recoverSessionActivity,
  type PublicRunRecord,
  type RepoRunRecord,
  type SessionRunQuery,
} from '@truecourse/core/lib/sessions-store';

const router: Router = Router();

/** The browser attaches to a job; ending this request never cancels that job. */
router.get('/:id/sessions/runs/:command/:runId/stream', async (req, res, next) => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(req.params.runId)) {
    res.status(400).json({ error: 'Invalid run ID' }); return;
  }
  const after = req.query.after === undefined ? -1 : Number(req.query.after);
  if (!Number.isSafeInteger(after) || after < -1 || (req.query.after !== undefined && !/^-?\d+$/.test(String(req.query.after)))) {
    res.status(400).json({ error: 'after must be a journal cursor' }); return;
  }
  const command = parseCommand(req.params.command);
  if (!command) { res.status(400).json({ error: 'Unknown session command' }); return; }
  const controller = new AbortController();
  const detach = () => controller.abort();
  res.once('close', detach);
  try {
    const repo = await resolveProjectForRequest(req.params.id);
    let run;
    try { run = await openStoredSessionRun(repo.path, command, req.params.runId); }
    catch (error) {
      if (!(error instanceof SessionRunNotFoundError)) throw error;
      res.status(404).json({ error: 'Session run not found.' }); return;
    }
    if (run.record().activityStream !== 'ai-sdk-v1') {
      res.status(409).json({ error: 'This run uses the legacy session transport' }); return;
    }
    if (!run.readActivity) recoverSessionActivity(run);
    // Reject bad cursors before sending SSE headers.
    try { await validateStoredActivityCursor(run, after); }
    catch (error) {
      if (error instanceof Error && error.message.startsWith('Activity cursor')) {
        res.status(400).json({ error: error.message }); return;
      }
      throw error;
    }
    const response = createUIMessageStreamResponse({
      stream: createActivityStream(run, after, controller.signal),
      headers: { 'X-Accel-Buffering': 'no', 'Cache-Control': 'no-cache, no-transform' },
    });
    response.headers.forEach((value, name) => res.setHeader(name, value));
    res.flushHeaders();
    await pipeline(Readable.fromWeb(response.body!), res, { signal: controller.signal });
  } catch (error) { if (!controller.signal.aborted) next(error); }
  finally { controller.abort(); res.removeListener('close', detach); }
});

/** `:command` straight from the URL — refuse anything the store never wrote. */
function parseCommand(raw: string): ReturnType<typeof SessionCommandSchema.parse> | null {
  const parsed = SessionCommandSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** A journal cursor from the query string: -1 (from the start) or an offset the
 *  store minted. null is a caller error, never a cursor to guess at. */
function parseAfter(raw: unknown): number | null {
  if (raw === undefined) return -1;
  if (typeof raw !== 'string' || !/^-?\d+$/.test(raw)) return null;
  const after = Number(raw);
  return Number.isSafeInteger(after) && after >= -1 ? after : null;
}

function parseLimit(raw: unknown, fallback: number, max: number): number | null {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const limit = Number(raw);
  return limit >= 1 && limit <= max ? limit : null;
}

/** History in bounded pages: what a reader walks before tailing the stream from
 *  the cursor it reached. Same refusals as the stream, minus the SSE. */
router.get('/:id/sessions/runs/:command/:runId/activity', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(req.params.runId as string)) {
      res.status(400).json({ error: 'Invalid run ID' }); return;
    }
    const command = parseCommand(req.params.command as string);
    if (!command) { res.status(400).json({ error: 'Unknown session command' }); return; }
    const after = parseAfter(req.query.after);
    if (after === null) { res.status(400).json({ error: 'after must be a journal cursor' }); return; }
    const limit = parseLimit(req.query.limit, 500, 1000);
    if (limit === null) { res.status(400).json({ error: 'limit must be between 1 and 1000' }); return; }
    if (req.query.compact !== undefined && req.query.compact !== '1') {
      res.status(400).json({ error: 'compact must be 1 when supplied' }); return;
    }
    const repo = await resolveProjectForRequest(req.params.id as string);
    let run;
    try { run = await openStoredSessionRun(repo.path, command, req.params.runId as string); }
    catch (error) {
      if (!(error instanceof SessionRunNotFoundError)) throw error;
      res.status(404).json({ error: 'Session run not found.' }); return;
    }
    if (run.record().activityStream !== 'ai-sdk-v1') {
      res.status(409).json({ error: 'This run uses the legacy session transport' }); return;
    }
    if (!run.readActivity) recoverSessionActivity(run);
    try {
      res.json(await readStoredActivityPage(run, after, limit, req.query.compact === '1'));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Activity cursor')) {
        res.status(400).json({ error: error.message }); return;
      }
      throw error;
    }
  } catch (e) {
    next(e);
  }
});

router.get('/:id/sessions/runs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    // listSessionRuns sweeps as a side effect: a run left `running` by a dead
    // pid reads `interrupted` here without any separate boot reconciliation.
    res.json({ runs: (await listStoredSessionRuns(repo.path)).map(toPublicRunRecord) });
  } catch (e) {
    next(e);
  }
});

router.get(
  '/:id/sessions/runs/:command/:runId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const command = parseCommand(req.params.command as string);
      if (!command) {
        res.status(400).json({ error: `Unknown session command: ${req.params.command}` });
        return;
      }
      try {
        const run = await openStoredSessionRun(repo.path, command, req.params.runId as string);
        res.json({ run: toPublicRunRecord(run.record()) });
      } catch (error) {
        if (!(error instanceof SessionRunNotFoundError)) throw error;
        res.status(404).json({ error: 'Session run not found.' });
      }
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/:id/sessions/runs/:command/:runId/transcript/:sessionId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const command = parseCommand(req.params.command as string);
      if (!command) {
        res.status(400).json({ error: `Unknown session command: ${req.params.command}` });
        return;
      }
      const since = req.query.since !== undefined ? Number(req.query.since) : -1;
      if (!Number.isFinite(since)) {
        res.status(400).json({ error: '?since must be a number (a seq cursor).' });
        return;
      }
      try {
        // Resolve the run before reading its session. File reads sanitize the
        // session ID; Postgres reads filter by session and sequence in the query.
        const run = await openStoredSessionRun(repo.path, command, req.params.runId as string);
        if (req.query.limit !== undefined) {
          const limit = parseLimit(req.query.limit, 100, 100);
          const before = req.query.before === undefined ? undefined : Number(req.query.before);
          if (limit === null || !Number.isSafeInteger(since) || since < -1 ||
              (before !== undefined && (!Number.isSafeInteger(before) || before < 0)) ||
              (before !== undefined && req.query.since !== undefined)) {
            res.status(400).json({ error: 'Invalid transcript page: limit 1–100; use before or since with integer sequence cursors.' }); return;
          }
          const sessionId = req.params.sessionId as string;
          const page = await readStoredTranscriptPage(run, sessionId, {
            limit, ...(before === undefined ? {} : { before }),
            ...(req.query.since === undefined ? {} : { since }),
          });
          res.json({ ...page, progress: readActivityProgress(run.dir)[sessionId] ?? null });
        } else {
          const events = await readStoredTranscript(run, req.params.sessionId as string, since);
          res.json({ events });
        }
      } catch (error) {
        if (!(error instanceof SessionRunNotFoundError)) throw error;
        res.status(404).json({ error: 'Session run not found.' });
      }
    } catch (e) {
      next(e);
    }
  },
);

export default router;

/**
 * Just enough of the GitHub link store to scope a workspace's runs: which
 * repositories it connected. Structural, so the real `GateStore` satisfies it
 * without this module depending on the GitHub package.
 */
export interface WorkspaceRepoLinks {
  listReposForWorkspace(workspaceOrgId: string): Promise<{ repoFullName: string }[]>;
}

export interface WorkspaceSessionsDeps {
  /** Present when the server has a GitHub App configured; null otherwise. */
  githubLinks?: WorkspaceRepoLinks | null;
}

/** A run as the workspace index reads it: the public record plus which
 *  repository it belongs to (`id` addresses `/api/repos/:id`). */
export type WorkspaceRun = PublicRunRecord & { repo: { id: string; fullName: string } };

/**
 * The repositories this caller's runs may come from. With a link store the
 * workspace is exactly what it connected, so a session without one has nothing
 * to read (401). Without a link store the server has no workspaces at all
 * (file mode) and the registry IS the workspace.
 */
async function workspaceRepos(deps: WorkspaceSessionsDeps, req: Request): Promise<RegistryEntry[]> {
  const entries = await readRegistry();
  const links = deps.githubLinks;
  if (!links) return entries;
  const org = req.user?.organizationId;
  if (!org) throw createAppError('This session has no workspace.', 401);
  const mine = new Set((await links.listReposForWorkspace(org)).map((r) => r.repoFullName));
  return entries.filter((e) => mine.has(e.name));
}

function toWorkspaceRun(run: RepoRunRecord, repos: Map<string, RegistryEntry>): WorkspaceRun {
  const { repoKey, ...record } = run;
  const repo = repos.get(repoKey)!;
  return { ...toPublicRunRecord(record), repo: { id: repo.slug, fullName: repo.name } };
}

export function createWorkspaceSessionsRouter(deps: WorkspaceSessionsDeps = {}): Router {
  const workspaceRouter: Router = Router();

  workspaceRouter.get('/runs', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entries = await workspaceRepos(deps, req);
      const query: SessionRunQuery = { limit: 50 };
      if (req.query.kind !== undefined) {
        const command = parseCommand(String(req.query.kind));
        if (!command) { res.status(400).json({ error: `Unknown session command: ${req.query.kind}` }); return; }
        query.command = command;
      }
      if (req.query.status !== undefined) {
        const status = RunStatusSchema.safeParse(String(req.query.status));
        if (!status.success) { res.status(400).json({ error: `Unknown run status: ${req.query.status}` }); return; }
        query.status = status.data;
      }
      const limit = parseLimit(req.query.limit, 50, 200);
      if (limit === null) { res.status(400).json({ error: 'limit must be between 1 and 200' }); return; }
      query.limit = limit;
      if (req.query.before !== undefined) {
        const before = String(req.query.before);
        if (!parseSessionRunCursor(before)) { res.status(400).json({ error: 'before must be a run cursor' }); return; }
        query.before = before;
      }
      // A repository the workspace never connected reads as absent, the same
      // way `/api/repos/:id` answers for one another workspace owns.
      let scope = entries;
      if (req.query.repo !== undefined) {
        const entry = entries.find((e) => e.slug === String(req.query.repo));
        if (!entry) { res.status(404).json({ error: `Project "${req.query.repo}" not found` }); return; }
        scope = [entry];
      }
      const runs = await listStoredSessionRunsForRepos(scope.map((e) => e.path), query);
      const repos = new Map(entries.map((e) => [e.path, e]));
      const last = runs[runs.length - 1];
      res.json({
        runs: runs.map((run) => toWorkspaceRun(run, repos)),
        ...(last && runs.length === limit ? { nextCursor: sessionRunCursor(last) } : {}),
      });
    } catch (e) {
      next(e);
    }
  });

  workspaceRouter.get('/runs/:runId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entries = await workspaceRepos(deps, req);
      const [run] = await listStoredSessionRunsForRepos(
        entries.map((e) => e.path),
        { runId: req.params.runId as string, limit: 1 },
      );
      if (!run) { res.status(404).json({ error: 'Session run not found.' }); return; }
      res.json({ run: toWorkspaceRun(run, new Map(entries.map((e) => [e.path, e]))) });
    } catch (e) {
      next(e);
    }
  });

  return workspaceRouter;
}
