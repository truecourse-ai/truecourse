/** Durable replay and direct publication for dashboard activity streams.
 * The worker and HTTP server run in the same process. The journal, rather
 * than a viewer's connection or an in-memory queue, owns event history.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ActivityEventSchema, type ActivityEvent, type ActivityEventBody } from '@truecourse/shared/activity-stream';
import type { SessionProgress } from '@truecourse/agent-loop';

const FILE = 'activity.jsonl';
const listeners = new Map<string, Set<(event?: ActivityEvent) => void>>();
const progress = new Map<string, Map<string, SessionProgress>>();

export function publishActivityProgress(dir: string, sessionId: string, value: SessionProgress): void {
  let sessions = progress.get(dir);
  if (!sessions) { sessions = new Map(); progress.set(dir, sessions); }
  sessions.set(sessionId, value);
  for (const notify of listeners.get(dir) ?? []) notify();
}

export function readActivityProgress(dir: string): Record<string, SessionProgress> {
  return Object.fromEntries(progress.get(dir) ?? []);
}

/** Only incomplete final records may be discarded, never a complete corrupt record. */
function completeSize(file: string): number {
  let fd: number;
  try { fd = fs.openSync(file, 'r'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
  try {
    let end = fs.fstatSync(fd).size;
    const buffer = Buffer.alloc(4096);
    while (end > 0) {
      const start = Math.max(0, end - buffer.length);
      const length = fs.readSync(fd, buffer, 0, end - start, start);
      const newline = buffer.subarray(0, length).lastIndexOf(10);
      if (newline !== -1) return start + newline + 1;
      end = start;
    }
    return 0;
  } finally { fs.closeSync(fd); }
}

export function appendActivityEvent(dir: string, body: ActivityEventBody): ActivityEvent {
  const file = path.join(dir, FILE);
  const cursor = completeSize(file);
  if (fs.existsSync(file) && fs.statSync(file).size !== cursor) fs.truncateSync(file, cursor);
  const serialized = JSON.stringify({ ...body, cursor });
  fs.appendFileSync(file, serialized + '\n');
  // A run's session index is mutable. Live delivery must carry the same detached
  // snapshot as replay, not a reference that a later index update can change.
  const event = JSON.parse(serialized) as ActivityEvent;
  publishCommittedActivity(dir, event);
  return event;
}

/** Publish only after the selected durable store commits. */
export function publishCommittedActivity(dir: string, event: ActivityEvent): void {
  if (event.kind === 'run') {
    if (event.run.status !== 'running') progress.delete(dir);
    else for (const session of event.run.sessions) {
      if (session.status !== 'running') progress.get(dir)?.delete(session.sessionId);
    }
  } else if (['assistant-turn', 'tool-result', 'outcome', 'failure'].includes(event.event.type)) {
    progress.get(dir)?.delete(event.sessionId);
  }
  if (progress.get(dir)?.size === 0) progress.delete(dir);
  for (const notify of listeners.get(dir) ?? []) notify(event);
}

/** Check a reconnect cursor without loading or decoding the journal. */
export function validateActivityCursor(dir: string, after: number): void {
  if (after < 0) return;
  const file = path.join(dir, FILE);
  const end = completeSize(file);
  if (after >= end) throw new Error('Activity cursor is beyond the journal');
  if (after === 0) return;
  const fd = fs.openSync(file, 'r');
  try {
    const preceding = Buffer.alloc(1);
    fs.readSync(fd, preceding, 0, 1, after - 1);
    if (preceding[0] !== 10) throw new Error('Activity cursor is not a record boundary');
  } finally { fs.closeSync(fd); }
}

export function readActivityEvents(dir: string, after = -1): ActivityEvent[] {
  validateActivityCursor(dir, after);
  const file = path.join(dir, FILE);
  const end = completeSize(file);
  if (end === 0) return [];
  const start = Math.max(0, after);
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(end - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString('utf8').trimEnd().split('\n').map(line => ActivityEventSchema.parse(JSON.parse(line)))
      .filter(event => event.cursor > after);
  } finally { fs.closeSync(fd); }
}

export function subscribeActivity(dir: string, notify: (event?: ActivityEvent) => void): () => void {
  let set = listeners.get(dir);
  if (!set) { set = new Set(); listeners.set(dir, set); }
  set.add(notify);
  return () => { set.delete(notify); if (set.size === 0) listeners.delete(dir); };
}
