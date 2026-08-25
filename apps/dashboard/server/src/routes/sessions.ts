/**
 * Agent-sessions routes — the dashboard read surface over the sessions store
 * (`.truecourse/sessions/<command>/<runId>/`, AGENTIC_PIPELINE_PLAN §3.9).
 * Read-only; the live tail rides the socket (`joinRun` → `session:*` events,
 * see ../services/session-tailer.service.ts).
 *
 *   GET /:id/sessions/runs                                    every run record, newest first
 *   GET /:id/sessions/runs/:command/:runId                    one run record (404 if absent)
 *   GET /:id/sessions/runs/:command/:runId/transcript/:sessionId
 *       one session's transcript events; ?since=<seq> returns only events past
 *       that cursor (the client's catch-up read after a socket subscribe)
 *
 * Every serialized record goes through `toPublicRunRecord` — `endpoint` holds
 * the session-API token and MUST never reach a browser.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { SessionCommandSchema } from '@truecourse/agent-loop';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import {
  listSessionRuns,
  openSessionRun,
  toPublicRunRecord,
} from '@truecourse/core/lib/sessions-store';

const router: Router = Router();

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
    res.json({ runs: listSessionRuns(repo.path).map(toPublicRunRecord) });
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
        const run = openSessionRun(repo.path, command, req.params.runId as string);
        res.json({ run: toPublicRunRecord(run.record()) });
      } catch {
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
        // openSessionRun 404s a bogus runId; readEvents sanitizes the session
        // id into the transcript filename, so the URL param never walks paths.
        const run = openSessionRun(repo.path, command, req.params.runId as string);
        const events = run.persistence.readEvents(req.params.sessionId as string);
        res.json({ events: since >= 0 ? events.filter((e) => e.seq > since) : events });
      } catch {
        res.status(404).json({ error: 'Session run not found.' });
      }
    } catch (e) {
      next(e);
    }
  },
);

export default router;
