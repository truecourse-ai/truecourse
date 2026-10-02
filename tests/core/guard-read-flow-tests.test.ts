/**
 * The flow reads, for flows a Playwright test proves: a stored scenario set
 * that carries a tests index gives each flow the status its test reached, the
 * list row says what a failing test observed and what a blocked flow waits on,
 * the detail carries the spec, the seed and the accepted run, and that run's
 * pictures resolve through the evidence reads every other test uses.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { PgGuardStore, PgSpecStore } from '../../packages/data-store/src/index';
import { setGuardStore, resetGuardStore } from '../../packages/core/src/lib/guard-store';
import { setSpecStore, resetSpecStore } from '../../packages/core/src/lib/spec-store';
import { setRepoDocReader } from '../../packages/core/src/lib/repo-doc-reader';
import { installMemoryGuardOverlays, resetGuardOverlayStore } from '../helpers/memory-guard-overlays';
import {
  listGuardEvidenceVisuals,
  listGuardFlows,
  readGuardFlowDetail,
} from '../../packages/core/src/commands/guard-read';
import {
  guardFlowPlainStatus,
  type FlowTestsFile,
  type GuardGenerateReport,
} from '../../packages/shared/src/index';

const REPO = 'acme/penny';
const COMMIT = 'c0ffee';
const DOC = 'docs/app.md';
const EVIDENCE = '.truecourse/guard/evidence/run-1/edit-expense';

const flow = (id: string, title: string) => ({
  id,
  title,
  goal: `${title}.`,
  fingerprint: `sha256:${id}`,
  milestones: [{ order: 1, doc: DOC, anchor: 'expenses', claimTitle: `${title} works` }],
  bindings: [{ doc: DOC, anchor: 'expenses', fingerprint: 'sha256:x' }],
  composedOf: [],
  synthesisInputsHash: 'sha256:s',
});

const TESTS: FlowTestsFile = {
  version: 1,
  generatedAt: '2026-10-02T12:00:00.000Z',
  tests: [
    {
      flowId: 'edit-expense',
      flowFingerprint: 'sha256:edit-expense',
      status: 'failing',
      file: 'edit-expense.spec.ts',
      seed: 'edit-expense.seed.ts',
      summary: 'Editing opens a dialog, not a page.',
      disagreement: { documented: 'Editing opens a separate page.', observed: 'Editing opens an in-page dialog.' },
      run: {
        ranAt: '2026-10-02T12:00:00.000Z',
        durationMs: 900,
        steps: [
          { order: 1, title: 'Edit opens a separate page', outcome: 'failed', durationMs: 800, error: 'expect(page).toHaveURL failed' },
          { order: 2, title: 'Saving announces the change', outcome: 'not-reached' },
        ],
        error: 'expect(page).toHaveURL failed',
        evidencePath: EVIDENCE,
      },
    },
    {
      flowId: 'open-expense',
      flowFingerprint: 'sha256:open-expense',
      status: 'passing',
      file: 'open-expense.spec.ts',
      summary: 'The details page shows the expense.',
    },
    {
      flowId: 'convert-expense',
      flowFingerprint: 'sha256:convert-expense',
      status: 'blocked',
      summary: 'No key.',
      blockedBy: 'Conversion needs a CurrencyBeacon API key this product does not have.',
      blockedOn: 'CurrencyBeacon API key',
    },
  ],
};

const REPORT: GuardGenerateReport = {
  generatedAt: '2026-10-02T12:00:00.000Z',
  status: 'ok',
  sectionsTotal: 1,
  sectionsChanged: 1,
  skippedUnchanged: 0,
  noChanges: false,
  written: [],
  coverageGaps: [],
  birthFindings: [],
  errors: [],
  extractionFailures: [],
  orphaned: [],
};

let client: PGlite;
let guardStore: PgGuardStore;

beforeEach(async () => {
  client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  guardStore = new PgGuardStore(db);
  setGuardStore(guardStore);
  setSpecStore(new PgSpecStore(db));
  installMemoryGuardOverlays();
  setRepoDocReader(async () => '# Expenses\nbody\n');

  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-flow-tests-read-'));
  try {
    fs.mkdirSync(path.join(src, 'tests'));
    fs.writeFileSync(
      path.join(src, 'flows.json'),
      JSON.stringify({
        version: 1,
        generatedAt: '2026-10-02T12:00:00.000Z',
        flows: [
          flow('edit-expense', 'Edit expense'),
          flow('open-expense', 'Open an expense'),
          flow('convert-expense', 'Convert an expense'),
          flow('delete-expense', 'Delete an expense'),
        ],
        noFlowClaims: [],
      }),
    );
    fs.writeFileSync(path.join(src, 'tests', 'tests.json'), JSON.stringify(TESTS));
    fs.writeFileSync(path.join(src, 'tests', 'edit-expense.spec.ts'), "import { flowTest } from './flow'\n");
    fs.writeFileSync(path.join(src, 'tests', 'edit-expense.seed.ts'), 'export async function seed() {}\n');
    fs.writeFileSync(path.join(src, 'tests', 'open-expense.spec.ts'), "import { test } from './flow'\n");
    const ref = { repoKey: REPO, commitSha: COMMIT };
    await guardStore.saveScenarios(ref, src);
    await guardStore.writeGuardResult(ref, REPORT);
    await guardStore.writeGuardResultEvidence(ref, 'edit-expense', {
      'step-1.png': Buffer.from('png'),
      'session.webm': Buffer.from('webm'),
    });
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
  }
});

afterEach(async () => {
  resetGuardStore();
  resetSpecStore();
  resetGuardOverlayStore();
  await client.close();
});

describe('flows proven by a Playwright test', () => {
  it('wear the status their test reached, and say what it observed or waits on', async () => {
    const { flows } = await listGuardFlows(REPO);
    const byId = new Map(flows.map((f) => [f.flowId, f]));

    expect(guardFlowPlainStatus(byId.get('edit-expense')!)).toBe('failed');
    expect(byId.get('edit-expense')!.test).toEqual({
      status: 'failing',
      seeded: true,
      documented: 'Editing opens a separate page.',
      observed: 'Editing opens an in-page dialog.',
    });

    expect(guardFlowPlainStatus(byId.get('open-expense')!)).toBe('succeeded');
    expect(byId.get('open-expense')!.test).toEqual({ status: 'passing', seeded: false });

    expect(guardFlowPlainStatus(byId.get('convert-expense')!)).toBe('blocked');
    expect(byId.get('convert-expense')!.test?.blockedOn).toBe('CurrencyBeacon API key');

    // A flow no test was written for reads as every ungenerated flow does.
    expect(byId.get('delete-expense')!.test).toBeUndefined();
    expect(guardFlowPlainStatus(byId.get('delete-expense')!)).toBe('blocked');
  });

  it('carry the spec, the seed and the accepted run in their detail', async () => {
    const detail = await readGuardFlowDetail(REPO, 'edit-expense');
    expect(detail?.status).toBe('fail');
    expect(detail?.test?.spec).toEqual({
      file: '.truecourse/scenarios/tests/edit-expense.spec.ts',
      content: "import { flowTest } from './flow'\n",
    });
    expect(detail?.test?.seed?.content).toBe('export async function seed() {}\n');
    expect(detail?.test?.run?.steps.map((s) => s.outcome)).toEqual(['failed', 'not-reached']);

    const blocked = await readGuardFlowDetail(REPO, 'convert-expense');
    expect(blocked?.test).toMatchObject({ status: 'blocked', blockedOn: 'CurrencyBeacon API key' });
    expect(blocked?.test?.spec).toBeUndefined();
  });

  it("resolve the run's pictures through the evidence reads", async () => {
    const visuals = await listGuardEvidenceVisuals(REPO, 'edit-expense', { evidenceDir: EVIDENCE });
    expect(visuals).toEqual([
      { file: 'step-1.png', kind: 'screenshot', step: 1 },
      { file: 'session.webm', kind: 'video' },
    ]);
  });
});
