/**
 * The LIVE half of the guard authoring feed: tails
 * `<repo>/.truecourse/guard/authoring/<runId>/<flowId>.<surface>.jsonl` and
 * forwards each appended complete JSONL line into the repo's socket room as
 * `guard:transcript` — `{ repoId, runId, flowId, surface, seq, events }`.
 *
 * `seq` is the transcript index of the batch's first event, counted over PARSED
 * events exactly as the backfill route counts them, so the client merges live
 * batches over the fetched backfill by index — no duplicate detection.
 *
 * This is an append TAIL, not a change watcher: no awaitWriteFinish (a live feed
 * must not wait for the file to go quiet), per-file byte offsets, and a torn
 * trailing line (no newline yet) stays unconsumed until the next change
 * completes it. `ignoreInitial: false`, so files that predate the tail — a run
 * already in progress when the first client joins — replay through the same
 * event.
 *
 * Lifecycle: started lazily when a client joins the repo's room and stopped when
 * the room empties (socket/handlers.ts), the same keying the activeSpec replay
 * uses. The authoring dir is born with a run's first transcript line and
 * chokidar 4 cannot adopt a path that does not exist yet, so a light existence
 * poll waits for it before the watcher takes over.
 */

import fs from 'node:fs';
import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { Server as SocketServer } from 'socket.io';
import { log } from '@truecourse/core/lib/logger';
import { getProjectBySlug } from '@truecourse/core/config/registry';
import { guardDir } from '@truecourse/guard-runner';
import { getIO } from '../socket/index.js';

export interface AuthoringTailBatch {
  runId: string;
  flowId: string;
  surface: string;
  /** Transcript index of `events[0]`, counted over parsed events. */
  seq: number;
  events: unknown[];
}

export interface AuthoringTailHandle {
  stop(): void;
}

/**
 * Tail every `<runId>/<flowId>.<surface>.jsonl` under `dir`, emitting one batch
 * per chunk of complete appended lines. Exported at this level so a test can
 * drive it with a temp dir and a spy — the repo-level wrappers below add the
 * registry lookup and the socket emit.
 */
export function createAuthoringTail(
  dir: string,
  emit: (batch: AuthoringTailBatch) => void,
  opts: { pollIntervalMs?: number; sweepIntervalMs?: number } = {},
): AuthoringTailHandle {
  const pollMs = opts.pollIntervalMs ?? 2000;
  const sweepMs = opts.sweepIntervalMs ?? 1000;
  const files = new Map<string, { offset: number; count: number }>();
  let watcher: FSWatcher | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let sweepTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const consume = (file: string): void => {
    // `<dir>/<runId>/<flowId>.<surface>.jsonl` — the surface is the LAST dot
    // segment before the extension; the flow id may itself contain dots.
    const rel = path.relative(dir, file);
    const segments = rel.split(path.sep);
    if (segments.length !== 2 || !segments[1]!.endsWith('.jsonl')) return;
    const runId = segments[0]!;
    const base = segments[1]!.slice(0, -'.jsonl'.length);
    const dot = base.lastIndexOf('.');
    if (dot <= 0 || dot === base.length - 1) return;
    const flowId = base.slice(0, dot);
    const surface = base.slice(dot + 1);

    let state = files.get(file);
    if (!state) {
      state = { offset: 0, count: 0 };
      files.set(file, state);
    }
    let buf: Buffer;
    try {
      const fd = fs.openSync(file, 'r');
      try {
        const size = fs.fstatSync(fd).size;
        if (size <= state.offset) return;
        buf = Buffer.alloc(size - state.offset);
        fs.readSync(fd, buf, 0, buf.length, state.offset);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return; // the file vanished mid-read — the next event retries
    }
    // Only complete lines are consumed: bytes after the last newline are a line
    // still being written, left at the old offset and re-read whole next time.
    const lastNewline = buf.lastIndexOf(0x0a);
    if (lastNewline === -1) return;
    const chunk = buf.subarray(0, lastNewline + 1).toString('utf-8');
    state.offset += lastNewline + 1;
    const events: unknown[] = [];
    for (const line of chunk.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed));
      } catch {
        /* a corrupt complete line — every reader skips it, so seq stays aligned */
      }
    }
    if (events.length === 0) return;
    const seq = state.count;
    state.count += events.length;
    emit({ runId, flowId, surface, seq, events });
  };

  // A dropped fs event must not stall the live feed until the next append:
  // a low-frequency sweep re-consumes every transcript under the dir. The
  // offset guard makes an idle sweep two syscalls per file.
  const sweep = (): void => {
    if (stopped) return;
    let runDirs: string[];
    try {
      runDirs = fs.readdirSync(dir);
    } catch {
      return; // the dir vanished — the poll or the next run recreates it
    }
    for (const runId of runDirs) {
      const runDir = path.join(dir, runId);
      let names: string[];
      try {
        names = fs.readdirSync(runDir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (name.endsWith('.jsonl')) consume(path.join(runDir, name));
      }
    }
  };

  const startWatcher = (): void => {
    if (stopped || watcher) return;
    watcher = watch(dir, { persistent: true, ignoreInitial: false });
    watcher.on('add', consume);
    watcher.on('change', consume);
    watcher.on('error', (error: unknown) => {
      log.error(
        `[AuthoringTail] ${dir}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    sweepTimer = setInterval(sweep, sweepMs);
  };

  if (fs.existsSync(dir)) {
    startWatcher();
  } else {
    pollTimer = setInterval(() => {
      if (!fs.existsSync(dir)) return;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      startWatcher();
    }, pollMs);
  }

  return {
    stop() {
      stopped = true;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (sweepTimer) {
        clearInterval(sweepTimer);
        sweepTimer = null;
      }
      if (watcher) {
        void watcher.close();
        watcher = null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Repo-level lifecycle — keyed by the socket room's repo slug
// ---------------------------------------------------------------------------

const tails = new Map<string, AuthoringTailHandle>();

/**
 * Start (idempotently) the authoring tail for a repo the moment a client joins
 * its room. The registry lookup is async, so the map slot is claimed
 * synchronously first — a second join during the lookup is a no-op.
 */
export function ensureAuthoringTail(repoId: string): void {
  if (tails.has(repoId)) return;
  let inner: AuthoringTailHandle | null = null;
  let cancelled = false;
  tails.set(repoId, {
    stop() {
      cancelled = true;
      inner?.stop();
    },
  });
  void getProjectBySlug(repoId)
    .then((entry) => {
      if (!entry) {
        tails.delete(repoId);
        return;
      }
      if (cancelled) return;
      // `authoring/` next to `evidence/` — see guard-runner/src/store.ts.
      const dir = path.join(guardDir(entry.path), 'authoring');
      inner = createAuthoringTail(dir, (batch) => {
        getIO().to(`repo:${repoId}`).emit('guard:transcript', { repoId, ...batch });
      });
      if (cancelled) inner.stop();
    })
    .catch((e) => {
      tails.delete(repoId);
      log.error(`[AuthoringTail] ${repoId}: ${e instanceof Error ? e.message : String(e)}`);
    });
}

/** Stop every tail whose repo room has emptied (a leave or a disconnect). */
export function stopIdleAuthoringTails(io: SocketServer): void {
  for (const [repoId, handle] of tails) {
    if ((io.sockets.adapter.rooms.get(`repo:${repoId}`)?.size ?? 0) === 0) {
      handle.stop();
      tails.delete(repoId);
    }
  }
}

export function stopAllAuthoringTails(): void {
  for (const [repoId, handle] of tails) {
    handle.stop();
    tails.delete(repoId);
  }
}
