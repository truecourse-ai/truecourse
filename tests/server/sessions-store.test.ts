/**
 * The OSS file sessions store:
 * `.truecourse/sessions/<command>/<runId>/run.json` + one transcript jsonl per
 * session, the boot reconciliation sweep, and truncated-final-line tolerance.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createSessionRun,
  listSessionRuns,
  openSessionRun,
  reconcileSessionsStore,
  sessionRunDir,
  toPublicRunRecord,
} from '../../packages/core/src/lib/sessions-store.js';
import { GITIGNORE_CONTENTS } from '../../packages/core/src/config/paths.js';
import { RunRecordSchema, SessionCommandSchema } from '../../packages/agent-loop/src/index';
import type { SessionEvent } from '../../packages/agent-loop/src/index';

let repo: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-sessions-store-'));
  fs.mkdirSync(path.join(repo, '.truecourse'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

const event = (seq: number, extra?: Partial<SessionEvent>): SessionEvent =>
  ({
    type: 'assistant-turn',
    text: `turn ${seq}`,
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      costUsd: 0,
      costSource: 'unpriced',
    },
    seq,
    ts: '2026-08-17T00:00:00.000Z',
    ...extra,
  }) as SessionEvent;

describe('sessions store', () => {
  it('creates a run record and round-trips transcript events', () => {
    const run = createSessionRun(repo, { command: 'spec-scan', gitRef: 'main' });

    // `<iso>_<short-uuid>` — sortable lexicographically ⇒ chronologically.
    expect(run.runId).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z_[0-9a-f]{8}$/);
    const runJson = path.join(sessionRunDir(repo, 'spec-scan', run.runId), 'run.json');
    const record = JSON.parse(fs.readFileSync(runJson, 'utf-8'));
    expect(record).toMatchObject({
      command: 'spec-scan',
      runId: run.runId,
      gitRef: 'main',
      status: 'running',
      pid: process.pid,
      sessions: [],
    });

    run.persistence.appendEvent('s1', event(0));
    run.persistence.appendEvent('s1', event(1));
    run.persistence.appendEvent('s2', event(0, { text: 'other session' } as Partial<SessionEvent>));
    expect(run.persistence.readEvents('s1')).toHaveLength(2);
    expect(run.persistence.readEvents('s1')[1]).toMatchObject({ seq: 1, text: 'turn 1' });
    expect(run.persistence.readEvents('s2')).toHaveLength(1);
    expect(run.persistence.readEvents('missing')).toEqual([]);

    run.persistence.updateIndex({
      sessionId: 's1',
      kind: 'spec-scan.curation',
      workItem: 'docs/a.md',
      status: 'running',
      spent: { turns: 2, tokens: 4, costUsd: 0 },
    });
    run.persistence.updateIndex({
      sessionId: 's1',
      kind: 'spec-scan.curation',
      workItem: 'docs/a.md',
      status: 'completed',
      resumeCursor: { providerSessionId: 'p-1' },
      spent: { turns: 3, tokens: 6, costUsd: 0 },
    });
    // Upsert, not append: one row per session, last write wins.
    const afterIndex = JSON.parse(fs.readFileSync(runJson, 'utf-8'));
    expect(afterIndex.sessions).toHaveLength(1);
    expect(afterIndex.sessions[0]).toMatchObject({
      sessionId: 's1',
      status: 'completed',
      resumeCursor: { providerSessionId: 'p-1' },
    });

    run.setEndpoint({ url: 'http://127.0.0.1:52341', token: 't0k' });
    expect(JSON.parse(fs.readFileSync(runJson, 'utf-8')).endpoint).toEqual({
      url: 'http://127.0.0.1:52341',
      token: 't0k',
    });

    run.finish('completed');
    const finished = JSON.parse(fs.readFileSync(runJson, 'utf-8'));
    expect(finished.status).toBe('completed');
    expect(typeof finished.finishedAt).toBe('string');
    // A dead endpoint must not be advertised.
    expect(finished.endpoint).toBeUndefined();
  });

  it('persists the run-level display blocks and serves them to browsers', () => {
    const run = createSessionRun(repo, { command: 'spec-scan', gitRef: 'main' });
    run.setChecklist([
      { key: 'discover', label: 'Discovering docs', status: 'done', detail: '142 docs' },
      { key: 'tag', label: 'Tagging doc areas', status: 'active' },
    ]);
    const reopened = openSessionRun(repo, 'spec-scan', run.runId);
    expect(reopened.record().display).toEqual({
      blocks: [
        {
          kind: 'checklist',
          items: [
            { key: 'discover', label: 'Discovering docs', status: 'done', detail: '142 docs' },
            { key: 'tag', label: 'Tagging doc areas', status: 'active' },
          ],
        },
      ],
    });
    // toPublicRunRecord strips endpoint/pid only — the display reaches the UI.
    expect(toPublicRunRecord(reopened.record()).display?.blocks).toHaveLength(1);
  });

  it('updates the checklist in place, leaving every other block standing', () => {
    // Progress is rewritten several times a second; anything else the run says
    // about itself must survive that, or the other lane has no viable writer.
    const run = createSessionRun(repo, { command: 'spec-scan', gitRef: 'main' });
    const runJson = path.join(sessionRunDir(repo, 'spec-scan', run.runId), 'run.json');
    const seeded = JSON.parse(fs.readFileSync(runJson, 'utf-8'));
    seeded.display = { blocks: [{ kind: 'facts', lines: ['41 docs discovered'] }] };
    fs.writeFileSync(runJson, JSON.stringify(seeded));

    const reopened = openSessionRun(repo, 'spec-scan', run.runId);
    reopened.setChecklist([{ key: 'tag', label: 'Tagging doc areas', status: 'active' }]);
    reopened.setChecklist([
      { key: 'tag', label: 'Tagging doc areas', status: 'done', detail: '12 docs' },
    ]);

    expect(openSessionRun(repo, 'spec-scan', run.runId).record().display).toEqual({
      blocks: [
        {
          kind: 'checklist',
          items: [{ key: 'tag', label: 'Tagging doc areas', status: 'done', detail: '12 docs' }],
        },
        { kind: 'facts', lines: ['41 docs discovered'] },
      ],
    });
  });

  it('reopens an existing run for resume and lists runs newest first', async () => {
    const first = createSessionRun(repo, { command: 'guard-generate', gitRef: 'main' });
    first.persistence.appendEvent('s1', event(0));
    first.finish('failed');
    await new Promise((r) => setTimeout(r, 5));
    const second = createSessionRun(repo, { command: 'guard-generate', gitRef: 'main' });

    const reopened = openSessionRun(repo, 'guard-generate', first.runId);
    expect(reopened.record().status).toBe('failed');
    expect(reopened.persistence.readEvents('s1')).toHaveLength(1);

    const runs = listSessionRuns(repo);
    expect(runs.map((r) => r.runId)).toEqual([second.runId, first.runId]);
    expect(listSessionRuns(repo, 'spec-scan')).toEqual([]);
  });

  it('gives run adjudication its own command directory (01 step 2d)', () => {
    // Adjudication runs against a RUN, on its own cadence — its own command.
    const run = createSessionRun(repo, { command: 'guard-adjudicate', gitRef: 'main' });
    const runJson = path.join(sessionRunDir(repo, 'guard-adjudicate', run.runId), 'run.json');
    expect(fs.existsSync(runJson)).toBe(true);

    const record = RunRecordSchema.parse(JSON.parse(fs.readFileSync(runJson, 'utf-8')));
    expect(record).toMatchObject({ command: 'guard-adjudicate', runId: run.runId, status: 'running' });
    expect(openSessionRun(repo, 'guard-adjudicate', run.runId).record().command).toBe(
      'guard-adjudicate',
    );

    // The widening is additive: every command that existed still parses.
    expect(SessionCommandSchema.options).toEqual([
      'spec-scan',
      'guard-setup',
      'guard-generate',
      'guard-interfaces',
      'guard-adjudicate',
    ]);
  });

  it('is gitignored entirely', () => {
    expect(GITIGNORE_CONTENTS).toContain('sessions/\n');
  });

  it('tolerates a crash-truncated final line but throws on mid-file corruption', () => {
    const run = createSessionRun(repo, { command: 'spec-scan', gitRef: 'main' });
    run.persistence.appendEvent('s1', event(0));
    run.persistence.appendEvent('s1', event(1));
    const transcript = path.join(run.dir, 's1.jsonl');
    // Simulate a crash mid-append: a partial JSON line with no newline.
    fs.appendFileSync(transcript, '{"type":"assistant-tur');
    const events = run.persistence.readEvents('s1');
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.seq)).toEqual([0, 1]);

    // A malformed line ANYWHERE else is real corruption, not a crash artifact.
    fs.writeFileSync(transcript, 'garbage\n' + JSON.stringify(event(1)) + '\n');
    expect(() => run.persistence.readEvents('s1')).toThrow(/corrupt transcript/);
  });
});

describe('reconciliation sweep', () => {
  it('marks dead running runs interrupted and parks their live sessions', () => {
    const dead = createSessionRun(repo, { command: 'guard-generate', gitRef: 'main' });
    dead.setEndpoint({ url: 'http://127.0.0.1:1', token: 't' });
    dead.persistence.updateIndex({
      sessionId: 's-running',
      kind: 'guard-generate.author',
      workItem: 'flow:a',
      status: 'running',
      spent: { turns: 1, tokens: 2, costUsd: 0 },
    });
    dead.persistence.updateIndex({
      sessionId: 's-waiting',
      kind: 'guard-generate.author',
      workItem: 'flow:b',
      status: 'waiting',
      spent: { turns: 1, tokens: 2, costUsd: 0 },
    });
    dead.persistence.updateIndex({
      sessionId: 's-done',
      kind: 'guard-generate.author',
      workItem: 'flow:c',
      status: 'completed',
      spent: { turns: 1, tokens: 2, costUsd: 0 },
    });
    const alive = createSessionRun(repo, { command: 'spec-scan', gitRef: 'main' });
    const finished = createSessionRun(repo, { command: 'spec-scan', gitRef: 'main' });
    finished.finish('completed');

    // The dead run's pid is "not alive"; the alive run's is.
    const { interrupted } = reconcileSessionsStore(repo, {
      isProcessAlive: () => false,
    });
    // `alive` is also swept here (same pid, scripted dead) — so re-read both
    // from disk and assert on the one we staged as crashed.
    expect(interrupted.map((r) => r.runId).sort()).toEqual([alive.runId, dead.runId].sort());

    const sweptDead = openSessionRun(repo, 'guard-generate', dead.runId).record();
    expect(sweptDead.status).toBe('interrupted');
    expect(typeof sweptDead.finishedAt).toBe('string');
    expect(sweptDead.endpoint).toBeUndefined();
    const byId = Object.fromEntries(sweptDead.sessions.map((s) => [s.sessionId, s.status]));
    expect(byId).toEqual({ 's-running': 'parked', 's-waiting': 'parked', 's-done': 'completed' });

    // A finished run is never touched.
    expect(openSessionRun(repo, 'spec-scan', finished.runId).record().status).toBe('completed');
  });

  /** Stage `run` as the leftovers of a process that is gone. */
  const orphan = (dir: string): void => {
    const runJson = path.join(dir, 'run.json');
    const record = JSON.parse(fs.readFileSync(runJson, 'utf-8'));
    // Above Linux's default pid_max — never a live process.
    record.pid = 0x7fffffff;
    fs.writeFileSync(runJson, JSON.stringify(record));
  };

  it('runs on its own at the two call sites that boot the store', () => {
    // Starting a run is a boot: a corpse from a previous process is reconciled
    // before this process writes anything of its own.
    const crashed = createSessionRun(repo, { command: 'guard-generate', gitRef: 'main' });
    crashed.persistence.updateIndex({
      sessionId: 's-running',
      kind: 'guard-generate.author',
      workItem: 'flow:a',
      status: 'running',
      spent: { turns: 1, tokens: 2, costUsd: 0 },
    });
    orphan(crashed.dir);

    const fresh = createSessionRun(repo, { command: 'spec-scan', gitRef: 'main' });
    const swept = openSessionRun(repo, 'guard-generate', crashed.runId).record();
    expect(swept.status).toBe('interrupted');
    expect(swept.sessions[0].status).toBe('parked');
    // This process's own run is untouched — its pid is alive.
    expect(openSessionRun(repo, 'spec-scan', fresh.runId).record().status).toBe('running');

    // And listing is the other boot: nothing is ever listed as `running` on a
    // dead process's memory, on disk or in the returned records.
    const second = createSessionRun(repo, { command: 'spec-scan', gitRef: 'main' });
    orphan(second.dir);
    const listed = listSessionRuns(repo).find((run) => run.runId === second.runId);
    expect(listed?.status).toBe('interrupted');
    expect(openSessionRun(repo, 'spec-scan', second.runId).record().status).toBe('interrupted');
  });

  it('leaves a running run with a live process alone', () => {
    const run = createSessionRun(repo, { command: 'spec-scan', gitRef: 'main' });
    const { interrupted } = reconcileSessionsStore(repo, { isProcessAlive: () => true });
    expect(interrupted).toEqual([]);
    expect(openSessionRun(repo, 'spec-scan', run.runId).record().status).toBe('running');
  });
});
