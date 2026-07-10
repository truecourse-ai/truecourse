/**
 * The `repo.guard` job definition on the shared harness, with the guard
 * onboarding pipeline faked (no clone, no LLM): single-flight enqueue keying,
 * step progress over the two-step checklist, the two success-notification
 * variants (scenarios generated vs. no-corpus), and failure → onError.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import type { GuardOnboardingPipeline } from '@truecourse/ee-github-app';
import {
  JobStore,
  NotificationStore,
  ActiveJobExistsError,
} from '../../ee/packages/data-store/src/index';
import { REPO_GUARD_TASK, guardJobKey } from '../../ee/packages/server/src/jobs/constants';
import { runGuardGenerate } from '../../ee/packages/server/src/jobs/worker';

const ORG = 'org_A';
const REPO = 'acme/api';

const GITHUB_ENV = {
  GITHUB_APP_ID: '1',
  GITHUB_APP_PRIVATE_KEY:
    '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
  GITHUB_APP_WEBHOOK_SECRET: 'whsec',
  GITHUB_APP_SLUG: 'tc-gate',
} as const;

let client: PGlite;
let db: EeDb;
let savedEnv: Record<string, string | undefined>;

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as EeDb;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  savedEnv = {};
  for (const [k, v] of Object.entries(GITHUB_ENV)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
});

afterEach(async () => {
  for (const k of Object.keys(GITHUB_ENV)) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await client.close();
});

function payloadFor(jobId: string) {
  return {
    jobId,
    workspaceOrgId: ORG,
    repoFullName: REPO,
    installationId: 42,
    defaultBranch: 'main',
    commitSha: 'abc1234567',
  };
}

describe('repo.guard — enqueue single-flight (per repo)', () => {
  it('creates a queued row, dedupes the same repo, frees the key on terminal', async () => {
    const store = new JobStore(db);

    const first = await store.create({ org: ORG, type: REPO_GUARD_TASK, key: guardJobKey(REPO) });
    expect(first.status).toBe('queued');
    expect(first.key).toBe('repo.guard:acme/api');

    await expect(
      store.create({ org: ORG, type: REPO_GUARD_TASK, key: guardJobKey(REPO) }),
    ).rejects.toBeInstanceOf(ActiveJobExistsError);

    // A different repo is independent.
    const other = await store.create({
      org: ORG,
      type: REPO_GUARD_TASK,
      key: guardJobKey('acme/web'),
    });
    expect(other.id).not.toBe(first.id);

    await store.markSucceeded(first.id, {});
    const rerun = await store.create({ org: ORG, type: REPO_GUARD_TASK, key: guardJobKey(REPO) });
    expect(rerun.status).toBe('queued');
  });
});

describe('runGuardGenerate — worker body', () => {
  it('drives clone → generate progress, succeeds, and notifies with the scenario count', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({ org: ORG, type: REPO_GUARD_TASK, key: guardJobKey(REPO) });

    const progressAfter: Array<{ current: number; total: number; message: string | null }> = [];
    const pipeline: GuardOnboardingPipeline = {
      run: vi.fn(async (deps, req, progress) => {
        expect(deps.auth).toBeDefined();
        expect(req).toEqual({
          repoFullName: REPO,
          installationId: 42,
          defaultBranch: 'main',
          commitSha: 'abc1234567',
        });
        expect(progress?.generateTracker).toBeDefined();
        for (const phase of ['clone', 'generate'] as const) {
          await progress?.onPhase?.(phase);
          const j = await jobStore.get(job.id);
          if (j) progressAfter.push({ ...j.progress });
        }
        return { savedFileCount: 5, scenariosWritten: 3, noCorpus: false };
      }),
    };

    await runGuardGenerate({ db, jobStore, notifications, pipeline }, payloadFor(job.id));

    expect(progressAfter.map((p) => p.message)).toEqual([
      'Cloning repository',
      'Generating scenarios',
    ]);
    expect(progressAfter.every((p) => p.total === 2)).toBe(true);
    expect(progressAfter.map((p) => p.current)).toEqual([0, 1]);

    const done = await jobStore.get(job.id);
    expect(done?.status).toBe('succeeded');
    expect(done?.result).toEqual({ repoFullName: REPO, scenariosWritten: 3, noCorpus: false });

    const notes = await notifications.listForOrg(ORG);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      kind: REPO_GUARD_TASK,
      level: 'success',
      title: 'Guard scenarios generated',
      body: 'acme/api — 3 guard scenarios generated.',
    });
    expect(notes[0]?.data).toMatchObject({ repoFullName: REPO, scenariosWritten: 3 });
  });

  it('a noCorpus run succeeds with the distinct "waiting for spec" wording', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({ org: ORG, type: REPO_GUARD_TASK, key: guardJobKey(REPO) });

    const pipeline: GuardOnboardingPipeline = {
      run: async () => ({ savedFileCount: 0, scenariosWritten: 0, noCorpus: true }),
    };

    await runGuardGenerate({ db, jobStore, notifications, pipeline }, payloadFor(job.id));

    expect((await jobStore.get(job.id))?.status).toBe('succeeded');
    const notes = await notifications.listForOrg(ORG);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.level).toBe('success');
    expect(notes[0]?.title).toBe('Guard scenarios — waiting for spec');
    expect(notes[0]?.body).toBe(
      'acme/api — no spec corpus yet; guard scenarios will generate once the spec is scanned.',
    );
    expect(notes[0]?.data).toMatchObject({ repoFullName: REPO, noCorpus: true });
  });

  it('singular wording for one scenario', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({ org: ORG, type: REPO_GUARD_TASK, key: guardJobKey(REPO) });

    const pipeline: GuardOnboardingPipeline = {
      run: async () => ({ savedFileCount: 3, scenariosWritten: 1, noCorpus: false }),
    };
    await runGuardGenerate({ db, jobStore, notifications, pipeline }, payloadFor(job.id));

    const notes = await notifications.listForOrg(ORG);
    expect(notes[0]?.body).toBe('acme/api — 1 guard scenario generated.');
  });

  it('marks the job failed and notifies when the pipeline throws (no retry)', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({ org: ORG, type: REPO_GUARD_TASK, key: guardJobKey(REPO) });

    const pipeline: GuardOnboardingPipeline = {
      run: async () => {
        throw new Error('LLM upstream 500');
      },
    };

    await expect(
      runGuardGenerate({ db, jobStore, notifications, pipeline }, payloadFor(job.id)),
    ).rejects.toThrow('LLM upstream 500'); // propagates → graphile records the permanent fail

    const failed = await jobStore.get(job.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('LLM upstream 500');

    const notes = await notifications.listForOrg(ORG);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      kind: REPO_GUARD_TASK,
      level: 'error',
      title: 'Guard generation failed — acme/api',
    });
    expect(notes[0]?.data).toMatchObject({ repoFullName: REPO, detail: 'LLM upstream 500' });
  });

  it('fails the job when the GitHub App is not configured', async () => {
    for (const k of Object.keys(GITHUB_ENV)) delete process.env[k];
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({ org: ORG, type: REPO_GUARD_TASK, key: guardJobKey(REPO) });

    const pipeline: GuardOnboardingPipeline = { run: vi.fn() };
    await expect(
      runGuardGenerate({ db, jobStore, notifications, pipeline }, payloadFor(job.id)),
    ).rejects.toThrow('the GitHub App is not configured');
    expect(pipeline.run).not.toHaveBeenCalled();
    expect((await jobStore.get(job.id))?.status).toBe('failed');
  });
});
