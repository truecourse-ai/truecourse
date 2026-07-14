/**
 * The `guard.spec-regen` job definition on the shared harness, with the head-regen
 * pipeline + re-gate faked (no clone, no LLM, no executor): step progress over the
 * four-phase checklist, the checkbox comment settling to done / nochange / error,
 * the re-gate running against the PR's regenerated corpus, and the success/failure
 * notifications.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import type {
  GuardHeadRegenPipeline,
  GuardGateRunRequest,
  GuardGateCorpus,
  GuardConflictsBlockedEmail,
  EmailNotifier,
} from '@truecourse/ee-github-app';
import { selectGateStore } from '@truecourse/ee-github-app';
import { JobStore, NotificationStore } from '../../ee/packages/data-store/src/index';
import {
  GUARD_SPEC_REGEN_TASK,
  guardSpecRegenJobKey,
  type GuardSpecRegenJobPayload,
} from '../../ee/packages/server/src/jobs/constants';
import { runGuardSpecRegen } from '../../ee/packages/server/src/jobs/worker';

const ORG = 'org_A';
const REPO = 'acme/api';
const HEAD_SHA = 'headsha1234567890';

const GITHUB_ENV = {
  GITHUB_APP_ID: '1',
  GITHUB_APP_PRIVATE_KEY:
    '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
  GITHUB_APP_WEBHOOK_SECRET: 'whsec',
  GITHUB_APP_SLUG: 'tc-gate',
} as const;

const CORPUS: GuardGateCorpus = {
  recipe: { build: 'npm run build', entry: ['node', 'cli.js'] },
  scenarios: [],
};

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

function payloadFor(
  jobId: string,
  over: Partial<GuardSpecRegenJobPayload> = {},
): GuardSpecRegenJobPayload {
  return {
    jobId,
    workspaceOrgId: ORG,
    repoFullName: REPO,
    installationId: 42,
    prNumber: 7,
    defaultBranch: 'main',
    baseBranch: 'main',
    baseSha: 'basesha0987654321',
    headSha: HEAD_SHA,
    headRef: 'feature/x',
    isFork: false,
    commentId: 5150,
    ...over,
  };
}

/** Fake octokit capturing checkbox-comment updates. */
function makeOctokit() {
  const calls = { update: [] as any[] };
  const octokit: any = {
    issues: {
      updateComment: async (p: any) => {
        calls.update.push(p);
      },
    },
  };
  return { octokit, calls };
}

function fakeNotifier() {
  const sent: Array<{ to: string[]; email: GuardConflictsBlockedEmail }> = [];
  const notifier: EmailNotifier = {
    sendGuardGateFailure: async () => {},
    sendGuardConflictsBlocked: async (to, email) => void sent.push({ to, email }),
  };
  return { notifier, sent };
}

async function linkRepo(
  over: Partial<Parameters<ReturnType<typeof selectGateStore>['linkRepo']>[0]> = {},
): Promise<void> {
  await selectGateStore(db).linkRepo({
    repoFullName: REPO,
    installationId: 42,
    workspaceOrgId: ORG,
    defaultBranch: 'main',
    blocking: true,
    enabled: true,
    notifyEmails: ['a@x.com'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });
}

/** A head-regen that came back blocked on open spec conflicts. */
const blockedRegen: GuardHeadRegenPipeline = {
  run: async () => ({ scenariosWritten: 0, noCorpus: false, corpus: null, openConflicts: 2 }),
};

describe('runGuardSpecRegen — worker body', () => {
  it('regenerates, re-gates against the PR corpus, settles the comment to done, and notifies', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({
      org: ORG,
      type: GUARD_SPEC_REGEN_TASK,
      key: guardSpecRegenJobKey(REPO, HEAD_SHA),
    });
    const { octokit, calls } = makeOctokit();

    const progressAfter: Array<string | null> = [];
    const headRegenPipeline: GuardHeadRegenPipeline = {
      run: vi.fn(async (deps, req, progress) => {
        expect(deps.auth).toBeDefined();
        expect(req).toMatchObject({ repoFullName: REPO, prNumber: 7, headSha: HEAD_SHA, baseBranch: 'main' });
        for (const phase of ['clone', 'scan', 'generate'] as const) {
          await progress?.onPhase?.(phase);
          const j = await jobStore.get(job.id);
          if (j) progressAfter.push(j.progress.message);
        }
        return { scenariosWritten: 3, noCorpus: false, corpus: CORPUS };
      }),
    };

    let regatedWith: { corpus: GuardGateCorpus; gateReq: GuardGateRunRequest } | null = null;
    const regate = vi.fn(async (corpus: GuardGateCorpus, gateReq: GuardGateRunRequest) => {
      regatedWith = { corpus, gateReq };
    });

    await runGuardSpecRegen(
      { db, jobStore, notifications, headRegenPipeline, regate, octokitFor: () => octokit },
      payloadFor(job.id),
    );

    // Progress advanced clone → scan → generate (→ gate posted after).
    expect(progressAfter).toEqual(['Cloning repository', 'Scanning spec documents', 'Generating scenarios']);

    // Re-gated against the PR's regenerated corpus, for the head.
    expect(regate).toHaveBeenCalledTimes(1);
    expect(regatedWith!.corpus).toBe(CORPUS);
    expect(regatedWith!.gateReq).toMatchObject({
      repoFullName: REPO,
      prNumber: 7,
      headSha: HEAD_SHA,
      checkRunId: null,
    });

    // The checkbox comment settled to done with the count.
    const last = calls.update[calls.update.length - 1];
    expect(last.comment_id).toBe(5150);
    expect(last.body).toContain('3 guard scenarios regenerated');

    const done = await jobStore.get(job.id);
    expect(done?.status).toBe('succeeded');
    const notes = await notifications.listForOrg(ORG);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: GUARD_SPEC_REGEN_TASK, level: 'success' });
  });

  it('a no-corpus head settles the comment to nochange, does NOT re-gate, and succeeds', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({
      org: ORG,
      type: GUARD_SPEC_REGEN_TASK,
      key: guardSpecRegenJobKey(REPO, HEAD_SHA),
    });
    const { octokit, calls } = makeOctokit();
    const headRegenPipeline: GuardHeadRegenPipeline = {
      run: async () => ({ scenariosWritten: 0, noCorpus: true, corpus: null }),
    };
    const regate = vi.fn();

    await runGuardSpecRegen(
      { db, jobStore, notifications, headRegenPipeline, regate, octokitFor: () => octokit },
      payloadFor(job.id),
    );

    expect(regate).not.toHaveBeenCalled();
    expect(calls.update[calls.update.length - 1].body).toContain('No guard scenarios to regenerate');
    expect((await jobStore.get(job.id))?.status).toBe('succeeded');
  });

  it('a failed regen settles the comment to error, fails the job, and notifies', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({
      org: ORG,
      type: GUARD_SPEC_REGEN_TASK,
      key: guardSpecRegenJobKey(REPO, HEAD_SHA),
    });
    const { octokit, calls } = makeOctokit();
    const headRegenPipeline: GuardHeadRegenPipeline = {
      run: async () => {
        throw new Error('LLM upstream 500');
      },
    };

    await expect(
      runGuardSpecRegen(
        { db, jobStore, notifications, headRegenPipeline, regate: vi.fn(), octokitFor: () => octokit },
        payloadFor(job.id),
      ),
    ).rejects.toThrow('LLM upstream 500');

    const last = calls.update[calls.update.length - 1];
    expect(last.body).toContain('Guard regeneration failed');
    expect(last.body).toContain('LLM upstream 500');

    const failed = await jobStore.get(job.id);
    expect(failed?.status).toBe('failed');
    const notes = await notifications.listForOrg(ORG);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      kind: GUARD_SPEC_REGEN_TASK,
      level: 'error',
      title: 'Guard regeneration failed — acme/api',
    });
  });

  it('a blocked (open-conflicts) regen settles the comment to blocked, skips the re-gate, and warns', async () => {
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({
      org: ORG,
      type: GUARD_SPEC_REGEN_TASK,
      key: guardSpecRegenJobKey(REPO, HEAD_SHA),
    });
    const { octokit, calls } = makeOctokit();
    const regate = vi.fn();

    await runGuardSpecRegen(
      { db, jobStore, notifications, headRegenPipeline: blockedRegen, regate, octokitFor: () => octokit },
      payloadFor(job.id),
    );

    // No re-gate on a blocked regen; the comment settles to the blocked notice.
    expect(regate).not.toHaveBeenCalled();
    const last = calls.update[calls.update.length - 1];
    expect(last.body).toContain('Scenario generation blocked');
    expect(last.body).toContain('2 open spec conflicts');

    // Completes (not fails) with a WARNING notification.
    expect((await jobStore.get(job.id))?.status).toBe('succeeded');
    const notes = await notifications.listForOrg(ORG);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      kind: GUARD_SPEC_REGEN_TASK,
      level: 'warning',
      title: 'Scenario generation blocked — 2 spec conflicts to resolve',
    });
  });

  it('emails the notify addresses on a blocked regen when the conflicts pref is on', async () => {
    await linkRepo();
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({
      org: ORG,
      type: GUARD_SPEC_REGEN_TASK,
      key: guardSpecRegenJobKey(REPO, HEAD_SHA),
    });
    const { octokit } = makeOctokit();
    const { notifier, sent } = fakeNotifier();

    await runGuardSpecRegen(
      { db, jobStore, notifications, headRegenPipeline: blockedRegen, regate: vi.fn(), octokitFor: () => octokit, notifier },
      payloadFor(job.id),
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['a@x.com']);
    expect(sent[0].email).toMatchObject({ repoFullName: REPO, conflicts: 2 });
  });

  it('does not email on a blocked regen when the conflicts pref is off', async () => {
    await linkRepo({ notifications: { gateFailure: true, conflicts: false } });
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({
      org: ORG,
      type: GUARD_SPEC_REGEN_TASK,
      key: guardSpecRegenJobKey(REPO, HEAD_SHA),
    });
    const { octokit } = makeOctokit();
    const { notifier, sent } = fakeNotifier();

    await runGuardSpecRegen(
      { db, jobStore, notifications, headRegenPipeline: blockedRegen, regate: vi.fn(), octokitFor: () => octokit, notifier },
      payloadFor(job.id),
    );

    expect(sent).toHaveLength(0);
    // The in-app warning still posts.
    expect((await notifications.listForOrg(ORG))[0]?.level).toBe('warning');
  });

  it('fails when the GitHub App is not configured (pipeline never runs)', async () => {
    for (const k of Object.keys(GITHUB_ENV)) delete process.env[k];
    const jobStore = new JobStore(db);
    const notifications = new NotificationStore(db);
    const job = await jobStore.create({
      org: ORG,
      type: GUARD_SPEC_REGEN_TASK,
      key: guardSpecRegenJobKey(REPO, HEAD_SHA),
    });
    const headRegenPipeline: GuardHeadRegenPipeline = {
      run: vi.fn() as unknown as GuardHeadRegenPipeline['run'],
    };

    await expect(
      runGuardSpecRegen(
        { db, jobStore, notifications, headRegenPipeline, regate: vi.fn() },
        payloadFor(job.id),
      ),
    ).rejects.toThrow('the GitHub App is not configured');
    expect(headRegenPipeline.run).not.toHaveBeenCalled();
    expect((await jobStore.get(job.id))?.status).toBe('failed');
  });
});
