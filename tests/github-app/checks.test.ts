/**
 * The Checks API client: the one check run per pull request check, its
 * summary rendered from the report (counts first, capped at what GitHub
 * takes), and its annotations on the changed documents' lines, fifty per
 * request. A fake Octokit records what would be sent.
 */
import { describe, it, expect } from 'vitest';
import type { PullRequestCheckReport } from '@truecourse/shared';
import {
  CHECK_NAME,
  createCheck,
  renderCheckOutput,
  updateCheck,
} from '../../packages/github-app/src/index';
import type { OctokitClient } from '../../packages/github-app/src/octokit';

function fakeOctokit() {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const octokit = {
    checks: {
      create: async (params: Record<string, unknown>) => {
        calls.push({ method: 'create', params });
        return { data: { id: 4242 } };
      },
      update: async (params: Record<string, unknown>) => {
        calls.push({ method: 'update', params });
        return { data: { id: 4242 } };
      },
    },
  } as unknown as OctokitClient;
  return { octokit, calls };
}

const report = (over: Partial<PullRequestCheckReport> = {}): PullRequestCheckReport => ({
  base: { mergeBase: 'b'.repeat(40), commit: 'b'.repeat(40), nearestWithBase: null },
  fork: false,
  conflictsCreated: [],
  docsMoved: [],
  repositoriesAffected: [],
  run: {
    runId: 'run-1',
    counts: { newFailures: 1, preExisting: 2, fixed: 0, newlyBlocked: 0, newlyCovered: 0, added: 0, retired: 0, held: 0 },
    newFailures: [{ id: 'f1', title: 'Checkout completes', scenarioIds: ['s1'], label: 'bug' }],
    preExisting: [{ id: 'f2', title: 'Login' }, { id: 'f3', title: 'Logout' }],
    fixed: [],
    newlyBlocked: [],
    newlyCovered: [],
    rewritten: [],
  },
  specHalf: 'no-documents-changed',
  codeHalf: 'ran',
  build: null,
  ...over,
});

describe('createCheck', () => {
  it('posts a queued check named TrueCourse, carrying our id as its external id', async () => {
    const { octokit, calls } = fakeOctokit();
    const id = await createCheck(octokit, 'acme/api', { headSha: 'head-1', externalId: 'check_1' });
    expect(id).toBe(4242);
    expect(calls).toEqual([
      {
        method: 'create',
        params: { owner: 'acme', repo: 'api', name: CHECK_NAME, head_sha: 'head-1', external_id: 'check_1', status: 'queued' },
      },
    ]);
  });
});

describe('updateCheck', () => {
  it('completes with the reason’s conclusion and no annotations in one request', async () => {
    const { octokit, calls } = fakeOctokit();
    await updateCheck(octokit, 'acme/api', 4242, {
      status: 'completed',
      reason: 'no-base',
      detailsUrl: 'https://app/agent/run-1',
      output: { title: 't', summary: 's' },
    });
    expect(calls).toEqual([
      {
        method: 'update',
        params: {
          owner: 'acme',
          repo: 'api',
          check_run_id: 4242,
          status: 'completed',
          conclusion: 'neutral',
          details_url: 'https://app/agent/run-1',
          output: { title: 't', summary: 's' },
        },
      },
    ]);
  });

  it('sends annotations fifty at a time, each request carrying the same output', async () => {
    const { octokit, calls } = fakeOctokit();
    const annotations = Array.from({ length: 120 }, (_, i) => ({
      path: 'docs/a.md',
      startLine: i + 1,
      message: `conflict ${i}`,
    }));
    await updateCheck(octokit, 'acme/api', 4242, {
      status: 'completed',
      reason: 'conflict',
      conclusion: 'failure',
      output: { title: 't', summary: 's', annotations },
    });
    expect(calls.map((c) => (c.params.output as { annotations: unknown[] }).annotations.length)).toEqual([50, 50, 20]);
    expect(calls.every((c) => c.params.conclusion === 'failure')).toBe(true);
    expect((calls[0]!.params.output as { annotations: Record<string, unknown>[] }).annotations[0]).toEqual({
      path: 'docs/a.md',
      start_line: 1,
      end_line: 1,
      annotation_level: 'failure',
      message: 'conflict 0',
    });
  });
});

/** A run of the expense tracker's flows, with what each case changes. */
const run = (over: Partial<NonNullable<PullRequestCheckReport['run']>> = {}): NonNullable<PullRequestCheckReport['run']> => ({
  runId: 'run-1',
  counts: { newFailures: 0, preExisting: 0, fixed: 0, newlyBlocked: 0, newlyCovered: 0, added: 0, retired: 0, held: 36 },
  newFailures: [],
  preExisting: [],
  fixed: [],
  newlyBlocked: [],
  newlyCovered: [],
  rewritten: [],
  ...over,
});

const PADDED = 'The details heading labels the entry with the expense ID padded to three digits, for example “ENTRY 007” for ID 7.';

describe('renderCheckOutput', () => {
  it('a broken behavior: the documented sentence, what the product did, and where the test stopped', () => {
    const out = renderCheckOutput(
      'new-failures',
      report({
        run: run({
          newFailures: [
            {
              id: 'expense-details',
              title: 'Expense details',
              scenarioIds: ['expense-details.spec.ts'],
              documented: { path: 'docs/app.md', line: 43, sentence: PADDED },
              observed: 'The details heading shows the ID without padding ("ENTRY 91" for ID 91).',
              step: { order: 3, of: 5, title: 'The details heading labels the entry with the expense ID padded to three digits.' },
            },
          ],
        }),
      }),
      'https://app/runs/run-1',
    );
    expect(out.title).toBe('1 documented behavior broke');
    expect(out.summary).toBe(
      [
        'This PR breaks a behavior the documentation describes. Fix the code, or update the document if the behavior changed on purpose.',
        `### Expense details\n\`docs/app.md:43\` "${PADDED}"\n**Observed:** The details heading shows the ID without padding ("ENTRY 91" for ID 91).\nFailed at step 3 of 5: *The details heading labels the entry with the expense ID padded to three digits.*`,
        '36 other documented flows still hold.',
        '[Full run](https://app/runs/run-1)',
      ].join('\n\n'),
    );
  });

  it('a failure that passed on the same commit earlier is said to be possibly flaky', () => {
    const out = renderCheckOutput(
      'new-failures',
      report({
        run: run({
          newFailures: [{ id: 'add', title: 'Add an expense', scenarioIds: [], observed: 'Expected: 725 · Received: -1000030972', passedEarlierSeconds: 19 }],
        }),
      }),
      null,
    );
    expect(out.summary).toContain('⚠ This test passed on this same commit 19 seconds earlier. It may be flaky.');
  });

  it('document conflicts on a sentence the PR edited: the earlier rulings, grouped under that sentence', () => {
    const edited = { path: 'docs/app.md', line: 43, sentence: 'The details heading names the entry by its ID, zero-padded to three digits: ID 7 reads “ENTRY 007”.', edited: true };
    const conflict = (sentence: string) => ({
      docs: ['context/src/docs/app.md', 'context/src/docs/product-requirements.md'] as [string, string],
      note: 'n',
      area: '',
      path: 'docs/app.md',
      line: 43,
      blocksRepositories: [],
      sides: [edited, { path: 'docs/product-requirements.md', line: 21, sentence, edited: false }],
      ruling: { at: '2026-10-08T11:35:26.333Z', right: 'docs/app.md' },
    });
    const out = renderCheckOutput(
      'conflict',
      report({
        run: null,
        codeHalf: 'stopped-by-conflict',
        conflictsCreated: [conflict('The details heading labels the entry with its description.'), conflict('The expense ID is never shown.')],
      }),
      'https://app/context/conflicts',
    );
    expect(out.title).toBe('2 document conflicts need a decision');
    expect(out.summary).toBe(
      [
        "Tests did not run: the documents disagree, and TrueCourse can't tell which one is right. This PR made changes in the document you had already ruled on, so that ruling no longer applies to it. Confirm it again [in TrueCourse](https://app/context/conflicts), or change one of the documents.",
        `**\`docs/app.md:43\`** (edited in this PR)\n"${edited.sentence}"\n\ndisagrees with\n\n` +
          '- `docs/product-requirements.md:21` "The details heading labels the entry with its description." On Oct 8 you ruled `docs/app.md` right.\n' +
          '- `docs/product-requirements.md:21` "The expense ID is never shown." On Oct 8 you ruled `docs/app.md` right.',
      ].join('\n\n'),
    );
    expect(out.annotations?.[0]).toEqual({
      path: 'docs/app.md',
      startLine: 43,
      message: 'Disagrees with docs/product-requirements.md:21: "The details heading labels the entry with its description."',
    });
  });

  it('a conflict no ruling covered asks for a decision', () => {
    const out = renderCheckOutput(
      'conflict',
      report({
        run: null,
        conflictsCreated: [
          {
            docs: ['a', 'b'],
            note: 'n',
            area: '',
            path: null,
            line: null,
            blocksRepositories: [],
            sides: [
              { path: 'docs/a.md', line: 3, sentence: 'Port 9090.', edited: true },
              { path: 'docs/b.md', line: 7, sentence: 'Port 8080.', edited: false },
            ],
            ruling: null,
          },
        ],
      }),
      null,
    );
    expect(out.title).toBe('1 document conflict needs a decision');
    expect(out.summary).toContain('This PR adds a sentence another document contradicts. Decide which one is right in TrueCourse, or change one of the documents.');
  });

  it('a head that does not build quotes the build', () => {
    const out = renderCheckOutput(
      'error',
      report({
        run: null,
        base: { mergeBase: '8369b60da4df', commit: '8369b60da4df', nearestWithBase: null },
        build: { failures: 5, output: './lib/store.ts:1:23\nError: Expression expected' },
      }),
      'https://app/agent/setup-1',
    );
    expect(out.title).toBe("The project doesn't build at this commit");
    expect(out.summary).toBe(
      [
        'The build failed 5 times, so no tests ran. The same build script worked on the default branch (`8369b60d`).',
        '```\n./lib/store.ts:1:23\nError: Expression expected\n```',
        '[Full build log](https://app/agent/setup-1)',
      ].join('\n\n'),
    );
  });

  it('everything held: the rewritten flows and the renames behind them', () => {
    const drift = { documented: 'Add expense', observed: 'New expense', at: { path: 'docs/app.md', line: 29, sentence: 's' } };
    const out = renderCheckOutput(
      'clean',
      report({
        run: run({
          rewritten: [
            { id: 'add', title: 'Add an expense', copyDrift: [drift] },
            { id: 'cancel', title: 'Cancel adding an expense', copyDrift: [drift] },
            { id: 'paginate', title: 'Paginate the expense list', copyDrift: [] },
          ],
        }),
      }),
      'https://app/runs/run-1',
    );
    expect(out.title).toBe('All documented flows succeeded. 3 flows were rewritten');
    expect(out.summary).toBe(
      [
        'Nothing in this PR breaks a behavior the documentation describes.',
        [
          '### Rewritten flows (3)',
          'A test changed so that it passes can hide a regression; these are worth a look.',
          '- **Add an expense**: the product says "New expense" where the docs say "Add expense" (`docs/app.md:29`).\n' +
            '- **Cancel adding an expense**: same rename.\n' +
            '- **Paginate the expense list**: its test was rewritten.',
        ].join('\n'),
        '[Full run](https://app/runs/run-1)',
      ].join('\n\n'),
    );
  });

  it('everything held and nothing rewritten', () => {
    expect(renderCheckOutput('clean', report({ run: run() }), null).title).toBe('All documented flows succeeded');
  });

  it('cuts back to the opening and the link when the whole would not fit', () => {
    const out = renderCheckOutput(
      'clean',
      report({ run: run({ preExisting: Array.from({ length: 3000 }, (_, i) => ({ id: `f${i}`, title: 'x'.repeat(40) })) }) }),
      'https://app/runs/run-1',
    );
    expect(out.summary).toBe('Nothing in this PR breaks a behavior the documentation describes.\n\n[Full run](https://app/runs/run-1)');
  });

  it('says what a settled check without a report means', () => {
    expect(renderCheckOutput('draft', null, null)).toEqual({
      title: 'Not checked: draft pull request',
      summary: 'Mark the pull request ready for review to check it.',
    });
    expect(renderCheckOutput('superseded', null, null).title).toBe('Replaced by the check of a newer commit');
  });

  it('names the commit to rebase onto when there is no base', () => {
    const out = renderCheckOutput(
      'no-base',
      report({ run: null, codeHalf: 'not-run', base: { mergeBase: '2d3a5af3aaaa', commit: null, nearestWithBase: '8369b60dbbbb' } }),
      null,
    );
    expect(out.title).toBe('Not checked: rebase onto a newer commit');
    expect(out.summary).toBe('This PR branched from `2d3a5af3`, which TrueCourse has not tested. Rebase onto `8369b60d` or a newer commit and the check will run.');
  });
});
