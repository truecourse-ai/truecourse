import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { type Express } from 'express';
import { appendAuthoringEvent } from '@truecourse/guard-runner';
import { createApp } from '../../apps/dashboard/server/src/app';
import {
  createAuthoringTail,
  type AuthoringTailBatch,
} from '../../apps/dashboard/server/src/services/authoring-tail.service';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';

/**
 * The guard authoring-transcript feed, both halves:
 *
 *   - the BACKFILL route (`GET /:id/guard/transcript`) — replays the JSONL a
 *     worker wrote via `appendAuthoringEvent`, `{ events: [] }` on a missing
 *     file (never 404 — the pane asks before the worker's first line), 400 on
 *     obviously invalid params;
 *   - the LIVE tail (`createAuthoringTail`) — per-file byte offsets, complete
 *     lines only (a torn trailing line waits for its completing append), `seq`
 *     counted over parsed events, and `ignoreInitial: false` replay of files
 *     that predate the tail.
 */

const RUN_ID = '2026-08-05T10-00-00Z_ab12cd34';
const FLOW_ID = 'task-lifecycle';
const SURFACE = 'cli';

const INIT = { kind: 'init', ts: '2026-08-05T10:00:00.000Z', system: 's', user: 'u', tools: ['run_scenario'], model: 'sonnet' };
const REPLY = { kind: 'reply', ts: '2026-08-05T10:00:01.000Z', turn: 1, text: 'authoring…' };
const END = { kind: 'end', ts: '2026-08-05T10:00:02.000Z', status: 'outcome', turns: 1, usage: { turns: 1, inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0.01 } };

describe('GET /:id/guard/transcript', () => {
  let app: Express;
  let fixture: TestFixture;
  let root: string;

  const url = (q: string) => `/api/repos/${fixture.project.slug}/guard/transcript?${q}`;
  const query = (runId: string, flowId: string, surface: string) =>
    new URLSearchParams({ runId, flowId, surface }).toString();

  beforeEach(async () => {
    fixture = await setupTestFixture();
    root = fixture.repoPath;
    app = createApp({ serveStatic: false });
  });
  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  it('round-trips the events a worker appended', async () => {
    appendAuthoringEvent(root, RUN_ID, FLOW_ID, SURFACE, INIT);
    appendAuthoringEvent(root, RUN_ID, FLOW_ID, SURFACE, REPLY);
    appendAuthoringEvent(root, RUN_ID, FLOW_ID, SURFACE, END);
    const res = await request(app).get(url(query(RUN_ID, FLOW_ID, SURFACE))).expect(200);
    expect(res.body).toEqual({ events: [INIT, REPLY, END] });
  });

  it('sanitizes a flow id the same way the writer did', async () => {
    // A flow id with separators lands in a sanitized filename; the raw id
    // must still address it.
    appendAuthoringEvent(root, RUN_ID, 'docs/spec.md#alpha', SURFACE, INIT);
    const res = await request(app).get(url(query(RUN_ID, 'docs/spec.md#alpha', SURFACE))).expect(200);
    expect(res.body).toEqual({ events: [INIT] });
  });

  it('answers { events: [] } for a transcript that does not exist yet — never 404', async () => {
    const res = await request(app).get(url(query(RUN_ID, 'never-authored', SURFACE))).expect(200);
    expect(res.body).toEqual({ events: [] });
  });

  it('rejects missing or traversal-shaped params', async () => {
    await request(app).get(url(query('', FLOW_ID, SURFACE))).expect(400);
    await request(app).get(url(query(RUN_ID, '', SURFACE))).expect(400);
    await request(app).get(url(query(RUN_ID, FLOW_ID, ''))).expect(400);
    await request(app).get(url(query('..', FLOW_ID, SURFACE))).expect(400);
    await request(app).get(url(query('../evidence', FLOW_ID, SURFACE))).expect(400);
    await request(app).get(url(query(RUN_ID, FLOW_ID, 'a/b'))).expect(400);
  });
});

describe('createAuthoringTail', () => {
  let dir: string;
  let stops: Array<() => void>;

  beforeEach(() => {
    dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-authoring-tail-')), 'authoring');
    stops = [];
  });
  afterEach(() => {
    for (const stop of stops) stop();
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  });

  const tail = (emit: (b: AuthoringTailBatch) => void) => {
    const handle = createAuthoringTail(dir, emit, { pollIntervalMs: 25 });
    stops.push(() => handle.stop());
    return handle;
  };
  const file = (runId: string, name: string) => path.join(dir, runId, name);
  const line = (ev: unknown) => JSON.stringify(ev) + '\n';

  it('emits appended complete lines with seq, skipping a torn trailing line until it completes', async () => {
    const batches: AuthoringTailBatch[] = [];
    tail((b) => batches.push(b));

    // The dir does not exist when the tail starts — the poll must adopt it.
    const f = file(RUN_ID, `${FLOW_ID}.${SURFACE}.jsonl`);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const torn = JSON.stringify(REPLY).slice(0, 12);
    fs.writeFileSync(f, line(INIT) + torn);

    await vi.waitFor(() => expect(batches.length).toBeGreaterThanOrEqual(1), { timeout: 5000, interval: 25 });
    expect(batches[0]).toEqual({ runId: RUN_ID, flowId: FLOW_ID, surface: SURFACE, seq: 0, events: [INIT] });

    // Completing the torn line re-reads it whole; seq continues where parsing left off.
    fs.appendFileSync(f, JSON.stringify(REPLY).slice(12) + '\n');
    await vi.waitFor(() => expect(batches.length).toBeGreaterThanOrEqual(2), { timeout: 5000, interval: 25 });
    expect(batches[1]).toEqual({ runId: RUN_ID, flowId: FLOW_ID, surface: SURFACE, seq: 1, events: [REPLY] });

    fs.appendFileSync(f, line(END));
    await vi.waitFor(() => expect(batches.length).toBeGreaterThanOrEqual(3), { timeout: 5000, interval: 25 });
    expect(batches[2]).toEqual({ runId: RUN_ID, flowId: FLOW_ID, surface: SURFACE, seq: 2, events: [END] });
  });

  it('replays files that predate the tail (a run already in progress at first join)', async () => {
    const f = file(RUN_ID, `${FLOW_ID}.${SURFACE}.jsonl`);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, line(INIT) + line(REPLY));

    const batches: AuthoringTailBatch[] = [];
    tail((b) => batches.push(b));
    await vi.waitFor(() => expect(batches.length).toBeGreaterThanOrEqual(1), { timeout: 5000, interval: 25 });
    expect(batches[0]).toEqual({ runId: RUN_ID, flowId: FLOW_ID, surface: SURFACE, seq: 0, events: [INIT, REPLY] });
  });

  it('splits the surface off the LAST dot segment — a flow id may itself carry dots', async () => {
    const f = file(RUN_ID, 'docs_spec.md_alpha.api.jsonl');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, line(INIT));

    const batches: AuthoringTailBatch[] = [];
    tail((b) => batches.push(b));
    await vi.waitFor(() => expect(batches.length).toBeGreaterThanOrEqual(1), { timeout: 5000, interval: 25 });
    expect(batches[0]).toMatchObject({ runId: RUN_ID, flowId: 'docs_spec.md_alpha', surface: 'api' });
  });

  it('ignores files that are not session transcripts', async () => {
    fs.mkdirSync(path.join(dir, RUN_ID), { recursive: true });
    fs.writeFileSync(path.join(dir, 'stray.jsonl'), line(INIT)); // not under a run dir
    fs.writeFileSync(file(RUN_ID, 'notes.txt'), 'hello');
    fs.writeFileSync(file(RUN_ID, 'nodot.jsonl'), line(INIT)); // no flow/surface split
    const f = file(RUN_ID, `${FLOW_ID}.${SURFACE}.jsonl`);
    fs.writeFileSync(f, line(END));

    const batches: AuthoringTailBatch[] = [];
    tail((b) => batches.push(b));
    await vi.waitFor(() => expect(batches.length).toBeGreaterThanOrEqual(1), { timeout: 5000, interval: 25 });
    // Let any straggler adds land before pinning the batch list.
    await new Promise((r) => setTimeout(r, 200));
    expect(batches).toEqual([
      { runId: RUN_ID, flowId: FLOW_ID, surface: SURFACE, seq: 0, events: [END] },
    ]);
  });
});
