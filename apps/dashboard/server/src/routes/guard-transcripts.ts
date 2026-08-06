/**
 * Guard authoring-transcript route — the BACKFILL half of the live session feed.
 *
 *   GET /:id/guard/transcript?runId=&flowId=&surface=   →  { events: [...] }
 *
 * Replays the append-only JSONL a generate worker writes under
 * `.truecourse/guard/authoring/<runId>/<flowId>.<surface>.jsonl`. A missing file
 * answers `{ events: [] }` with 200, never 404: the flow-detail pane asks before
 * the worker's first line lands. Live appends ride the `guard:transcript` socket
 * event (services/authoring-tail.service); this route reads the same file, so a
 * finished run replays identically to a live one.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import { readAuthoringTranscript } from '@truecourse/guard-runner';

const router: Router = Router();

// The reader sanitizes every segment itself; this only rejects the obviously
// invalid. `runId` becomes a directory name where dots survive sanitizing, so a
// traversal token must bounce here; `flowId`/`surface` land inside a FILENAME
// (separators sanitized away) and only need to be present and separator-free
// for `surface` (a flow id may legitimately carry `/` — sanitizing maps it).
function badRunId(s: string): boolean {
  return !s || s.includes('/') || s.includes('\\') || s.includes('..');
}

router.get('/:id/guard/transcript', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const runId = String(req.query.runId ?? '');
    const flowId = String(req.query.flowId ?? '');
    const surface = String(req.query.surface ?? '');
    if (badRunId(runId) || !flowId || !surface || /[/\\]/.test(surface)) {
      res.status(400).json({ error: 'Missing or invalid ?runId=, ?flowId= or ?surface=.' });
      return;
    }
    res.json({ events: readAuthoringTranscript(repo.path, runId, flowId, surface) });
  } catch (e) {
    next(e);
  }
});

export default router;
