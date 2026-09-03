/**
 * The live tail of one agent-sessions run: the
 * engine process appends transcript events to `<runDir>/<sessionId>.jsonl` and
 * rewrites `run.json`; this service watches the run directory and forwards
 * every appended event (and each run-record update) to the socket layer, which
 * broadcasts into the run's room.
 *
 * Offsets start at the CURRENT file sizes: the client joins the room FIRST and
 * fetches its REST snapshot SECOND (subscribe-then-snapshot ordering),
 * so anything the tail skipped is in the snapshot and anything doubled is
 * deduped by `seq` client-side. A trailing partial line (append in flight) is
 * left unconsumed — the offset only ever advances past complete lines.
 *
 * Tails are refcounted per (repoPath, command, runId): the first viewer starts
 * the watcher, the last one leaving stops it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { SessionCommand, SessionEvent } from '@truecourse/agent-loop';
import { RunRecordSchema } from '@truecourse/agent-loop';
import {
  sessionRunDir,
  sessionsDir,
  toPublicRunRecord,
  type PublicRunRecord,
} from '@truecourse/core/lib/sessions-store';
import { log } from '@truecourse/core/lib/logger';

export interface RunTailTarget {
  repoPath: string;
  command: SessionCommand;
  runId: string;
}

export interface RunTailSink {
  onEvent(sessionId: string, event: SessionEvent): void;
  onRunUpdated(run: PublicRunRecord): void;
}

interface Tail {
  watcher: FSWatcher;
  refs: number;
  /** Consumed bytes per transcript file (absolute path → offset). */
  offsets: Map<string, number>;
}

const tails = new Map<string, Tail>();

const keyOf = (t: RunTailTarget): string => `${t.repoPath}|${t.command}|${t.runId}`;

/** Start (or join) the tail of one run. Every acquire needs a matching release. */
export function acquireRunTail(target: RunTailTarget, sink: RunTailSink): void {
  const key = keyOf(target);
  const existing = tails.get(key);
  if (existing) {
    existing.refs++;
    return;
  }

  const dir = sessionRunDir(target.repoPath, target.command, target.runId);
  const offsets = new Map<string, number>();
  // Existing transcripts are the snapshot's job — tail only what lands next.
  for (const name of listJsonl(dir)) {
    const file = path.join(dir, name);
    offsets.set(file, statSize(file));
  }

  const onFile = (file: string): void => {
    const base = path.basename(file);
    if (base === 'run.json') {
      const run = readRunRecord(file);
      if (run) sink.onRunUpdated(run);
      return;
    }
    if (!base.endsWith('.jsonl')) return;
    const sessionId = base.slice(0, -'.jsonl'.length);
    for (const event of consumeAppended(offsets, file)) sink.onEvent(sessionId, event);
  };

  const watcher = watch(dir, { ignoreInitial: true, depth: 0 });
  watcher.on('add', onFile);
  watcher.on('change', onFile);
  watcher.on('error', (err) => log.warn(`[SessionTail] watcher error on ${dir}: ${String(err)}`));

  tails.set(key, { watcher, refs: 1, offsets });
}

/** Release one hold on a run's tail; the last release stops the watcher. */
export function releaseRunTail(target: RunTailTarget): void {
  const key = keyOf(target);
  const tail = tails.get(key);
  if (!tail) return;
  tail.refs--;
  if (tail.refs > 0) return;
  tails.delete(key);
  void tail.watcher.close();
}

/** Shutdown hook — close every live watcher. */
export function stopAllRunTails(): void {
  for (const tail of tails.values()) void tail.watcher.close();
  tails.clear();
  for (const w of runsWatches.values()) {
    clearTimeout(w.pending);
    void w.watcher.close();
  }
  runsWatches.clear();
}

// ---------------------------------------------------------------------------
// The runs-list watch: one per repo, refcounted like the tails. Any run.json
// created or rewritten anywhere under `sessions/` (a new run, a session index
// update, a finish) fires the callback — debounced, since an atomic write can
// surface as several fs events — and the socket layer tells the repo room to
// re-read its runs list. This is what makes a CLI-started run appear without
// a page refresh.
// ---------------------------------------------------------------------------

interface RunsWatch {
  watcher: FSWatcher;
  refs: number;
  pending?: ReturnType<typeof setTimeout>;
}

const runsWatches = new Map<string, RunsWatch>();

const RUNS_DEBOUNCE_MS = 250;

/** Start (or join) a repo's runs-list watch. Pair every acquire with a release. */
export function acquireRunsWatch(repoPath: string, onChange: () => void): void {
  const existing = runsWatches.get(repoPath);
  if (existing) {
    existing.refs++;
    return;
  }
  // chokidar (4.x, pinned) never attaches to a directory that does not exist:
  // no add/change/error events, even after the tree appears later. A fresh
  // repo has no `sessions/` until its first run, so without this the watch
  // would sit dead and the first run would never reach the room. Guarded on
  // the RESOLVED dir being absolute: a hosted repo identity resolves under the
  // global dir (mkdir there is fine — the scan mints the same path), while a
  // bare identity with no resolver installed resolves relative to cwd, and a
  // relative mkdir is nobody's intent. Best-effort: an unwritable tree just
  // leaves the watch as dead as it was before.
  try {
    const dir = sessionsDir(repoPath);
    if (path.isAbsolute(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* the watcher's own error handler reports anything further */
  }
  // depth 2: sessions/<command>/<runId>/run.json
  const watcher = watch(sessionsDir(repoPath), { ignoreInitial: true, depth: 2 });
  const entry: RunsWatch = { watcher, refs: 1 };
  const onFile = (file: string): void => {
    if (path.basename(file) !== 'run.json') return;
    clearTimeout(entry.pending);
    entry.pending = setTimeout(onChange, RUNS_DEBOUNCE_MS);
  };
  watcher.on('add', onFile);
  watcher.on('change', onFile);
  watcher.on('error', (err) => log.warn(`[SessionTail] runs watcher error on ${repoPath}: ${String(err)}`));
  runsWatches.set(repoPath, entry);
}

/** Release one hold on a repo's runs-list watch; the last release stops it. */
export function releaseRunsWatch(repoPath: string): void {
  const entry = runsWatches.get(repoPath);
  if (!entry) return;
  entry.refs--;
  if (entry.refs > 0) return;
  runsWatches.delete(repoPath);
  clearTimeout(entry.pending);
  void entry.watcher.close();
}

/**
 * Read everything appended past the consumed offset and parse the COMPLETE
 * lines; the offset advances only through the final newline, so a line still
 * being appended is re-read whole on the next change. A line that ends in a
 * newline but does not parse is real corruption — skipped loudly, offset
 * advanced past it (a stuck tail would otherwise re-log it forever).
 */
function consumeAppended(offsets: Map<string, number>, file: string): SessionEvent[] {
  const size = statSize(file);
  let offset = offsets.get(file) ?? 0;
  if (size < offset) offset = 0; // replaced file — start over
  if (size === offset) return [];

  let fd: number;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return [];
  }
  let chunk: string;
  try {
    const buf = Buffer.alloc(size - offset);
    const read = fs.readSync(fd, buf, 0, buf.length, offset);
    chunk = buf.subarray(0, read).toString('utf-8');
  } finally {
    fs.closeSync(fd);
  }

  const lastNewline = chunk.lastIndexOf('\n');
  if (lastNewline === -1) return [];
  const complete = chunk.slice(0, lastNewline);
  offsets.set(file, offset + Buffer.byteLength(chunk.slice(0, lastNewline + 1), 'utf-8'));

  const events: SessionEvent[] = [];
  for (const line of complete.split('\n')) {
    if (line.trim() === '') continue;
    try {
      events.push(JSON.parse(line) as SessionEvent);
    } catch (err) {
      log.warn(`[SessionTail] corrupt transcript line in ${file}: ${String(err)}`);
    }
  }
  return events;
}

function readRunRecord(file: string): PublicRunRecord | null {
  try {
    return toPublicRunRecord(RunRecordSchema.parse(JSON.parse(fs.readFileSync(file, 'utf-8'))));
  } catch {
    // Mid-rename read of the atomic write — the next change event re-reads.
    return null;
  }
}

function statSize(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function listJsonl(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((name) => name.endsWith('.jsonl'));
  } catch {
    return [];
  }
}
