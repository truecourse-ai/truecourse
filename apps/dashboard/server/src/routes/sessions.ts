/**
 * Agent-sessions routes — the dashboard read surface over the sessions store
 * (Postgres for dashboard repositories, local files for file-mode callers).
 * Read-only. Dashboard activity runs expose a replayable AI SDK SSE stream;
 * legacy runs use the socket tail (`joinRun` → `session:*` events).
 *
 *   GET /:id/sessions/runs                                    every run record, newest first
 *   GET /:id/sessions/runs/:command/:runId                    one run record (404 if absent)
 *   GET /:id/sessions/runs/:command/:runId/stream             replay + live, ?after=<cursor>
 *   GET /:id/sessions/runs/:command/:runId/transcript/:sessionId
 *       one session's transcript events; ?since=<seq> returns only events past
 *       that cursor (the client's catch-up read after a socket subscribe)
 *
 * Every serialized record goes through `toPublicRunRecord` — `endpoint` holds
 * the session-API token and MUST never reach a browser.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createUIMessageStreamResponse } from 'ai';
import { createActivityStream } from '../services/activity-stream.service.js';
import { SessionCommandSchema } from '@truecourse/agent-loop';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import {
  SessionRunNotFoundError,
  listStoredSessionRuns,
  openStoredSessionRun,
  toPublicRunRecord,
  validateStoredActivityCursor,
  readStoredTranscript,
  recoverSessionActivity,
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
        const events = await readStoredTranscript(run, req.params.sessionId as string, since);
        res.json({ events });
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
