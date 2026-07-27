import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { type Express } from 'express';

/**
 * The Journeys tab's MAP action (OSS): `POST /:id/guard/map` derives the journey
 * catalog from the working tree and answers with the fresh catalog view.
 *
 * Mapping is deterministic and LLM-free — no estimate gate, no confirmation — so
 * the real service runs here (analyzer + journey-mapper over a temp repo): the
 * test proves the snapshot lands on disk and the response is the same shape
 * `GET /guard/journeys` returns. The concurrency case swaps in a controllable
 * implementation, since a 409 needs a job still in flight.
 */

vi.mock('@truecourse/core/services/journey', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@truecourse/core/services/journey')>();
  return { ...actual, mapJourneys: vi.fn(actual.mapJourneys) };
});

import { createApp } from '../../apps/dashboard/server/src/app';
import { mapJourneys } from '@truecourse/core/services/journey';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';

// A small commander CLI — the surface the mapper derives journeys from.
const CLI_SOURCE = [
  "import { Command } from 'commander';",
  '',
  'const program = new Command();',
  "program.name('tasks').description('A tiny task manager');",
  '',
  'program',
  "  .command('add')",
  "  .description('Add a task')",
  "  .option('--json', 'print the created task as JSON')",
  '  .action(() => {});',
  '',
  'program',
  "  .command('list')",
  "  .description('List tasks')",
  "  .option('--done', 'only completed tasks')",
  '  .action(() => {});',
  '',
  'program.parse();',
  '',
].join('\n');

describe('Guard map action', () => {
  let app: Express;
  let fixture: TestFixture;
  let root: string;

  const url = (suffix: string) => `/api/repos/${fixture.project.slug}/guard/${suffix}`;

  beforeEach(async () => {
    fixture = await setupTestFixture();
    root = fixture.repoPath;
    app = createApp({ serveStatic: false });
    vi.mocked(mapJourneys).mockClear();
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'cli.ts'), CLI_SOURCE);
  });
  afterEach(async () => {
    vi.mocked(mapJourneys).mockReset();
    await teardownTestFixture(fixture.project.slug);
  });

  it('writes the catalog snapshot and answers with the journeys view', async () => {
    // Before mapping the tab is in its CTA state.
    const before = await request(app).get(url('journeys')).expect(200);
    expect(before.body.mapped).toBe(false);

    const res = await request(app).post(url('map')).expect(200);
    expect(res.body.mapped).toBe(true);
    // The commander commands in the tree become journeys — deterministic, no LLM.
    expect(res.body.journeys.map((j: { id: string }) => j.id).sort()).toEqual(['cli/add', 'cli/list']);
    expect(res.body.totals).toMatchObject({ journeys: 2, detectedSurfaces: 1, grounded: 0, ungrounded: 2 });
    // The banner always lists every registry surface, mapped or not.
    expect(res.body.surfaces.some((s: { surface: string }) => s.surface === 'cli')).toBe(true);

    const snapshot = path.join(root, '.truecourse', 'guard', 'journeys.json');
    expect(fs.existsSync(snapshot)).toBe(true);
    expect(JSON.parse(fs.readFileSync(snapshot, 'utf-8'))).toMatchObject({ version: 1 });

    // The follow-up read agrees with the action's response (one source, two routes).
    const after = await request(app).get(url('journeys')).expect(200);
    expect(after.body).toEqual(res.body);
  }, 60_000);

  it('rejects a concurrent map with 409 (the shared per-repo guard job)', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(mapJourneys).mockImplementation(async () => {
      await held;
      return {
        catalog: { version: 1, generatedAt: '2026-07-24T00:00:00.000Z', recipeFingerprint: '', journeys: [] },
        fingerprints: {},
        snapshotPath: path.join(root, '.truecourse', 'guard', 'journeys.json'),
      };
    });

    // `.then(...)` fires the request now (supertest is otherwise lazy); await it at
    // the end. Give the first handler time to claim the per-repo job slot.
    const firstDone = request(app).post(url('map')).then((r) => r);
    await new Promise((r) => setTimeout(r, 150));

    const second = await request(app).post(url('map')).expect(409);
    expect(second.body.error).toMatch(/already running/i);
    // Generate and run share the same one-job-per-repo slot.
    await request(app).post(url('run')).expect(409);

    release();
    expect((await firstDone).status).toBe(200);

    // The slot is released, so the next map runs.
    await request(app).post(url('map')).expect(200);
  });
});
