import { describe, it, expect, beforeEach } from 'vitest';
import {
  createEmailNotifier,
  type ResendLike,
} from '../../ee/packages/github-app/src/index';

function drift(over: Record<string, unknown> = {}): any {
  return {
    id: 'x',
    artifactRef: { type: 'Operation', identity: 'GET /a' },
    obligationKey: 'ob1',
    severity: 'high',
    filePath: 'src/a.ts',
    lineStart: 10,
    lineEnd: 12,
    message: 'response missing field <email>',
    ...over,
  };
}

let sends: any[];
let result: { error?: { message: string } | null };
const client: ResendLike = {
  emails: {
    send: async (opts) => {
      sends.push(opts);
      return result;
    },
  },
};

beforeEach(() => {
  sends = [];
  result = { error: null };
});

describe('createEmailNotifier', () => {
  it('sends a gate-failure email to the recipients', async () => {
    const notifier = createEmailNotifier('re_test', 'TrueCourse <bot@tc.dev>', client);
    await notifier.sendGateFailure(['a@x.com', 'b@y.com'], {
      repoFullName: 'acme/api',
      prNumber: 7,
      prUrl: 'https://github.com/acme/api/pull/7',
      added: [drift()],
    });

    // One message per recipient (no cross-disclosure).
    expect(sends).toHaveLength(2);
    expect(sends.map((s) => s.to)).toEqual([['a@x.com'], ['b@y.com']]);
    expect(sends[0].from).toBe('TrueCourse <bot@tc.dev>');
    expect(sends[0].subject).toContain('acme/api');
    expect(sends[0].subject).toContain('#7');
    expect(sends[0].html).toContain('https://github.com/acme/api/pull/7');
    expect(sends[0].html).toContain('src/a.ts:10');
    // HTML-escaped drift message
    expect(sends[0].html).toContain('&lt;email&gt;');
  });

  it('does not send when there are no recipients', async () => {
    const notifier = createEmailNotifier('re_test', 'from@tc.dev', client);
    await notifier.sendGateFailure([], {
      repoFullName: 'acme/api',
      prNumber: 7,
      prUrl: 'u',
      added: [drift()],
    });
    expect(sends).toHaveLength(0);
  });

  it('swallows Resend errors (notifications are best-effort)', async () => {
    result = { error: { message: 'bad key' } };
    const notifier = createEmailNotifier('re_test', 'from@tc.dev', client);
    await expect(
      notifier.sendGateFailure(['a@x.com'], {
        repoFullName: 'acme/api',
        prNumber: 7,
        prUrl: 'u',
        added: [drift()],
      }),
    ).resolves.toBeUndefined();
    expect(sends).toHaveLength(1);
  });

  it('sends an infer-result email with decisions and the short commit sha', async () => {
    const notifier = createEmailNotifier('re_test', 'bot@tc.dev', client);
    await notifier.sendInferResult(['a@x.com'], {
      repoFullName: 'acme/api',
      prNumber: 7,
      prUrl: 'https://github.com/acme/api/pull/7',
      decisions: [
        { kind: 'Operation', identity: 'GET /a', path: 'src/a.ts', line: 3, reason: 'returns <x>' },
      ],
      changedContracts: ['.truecourse/contracts/_inferred/a.tc'],
      commitSha: 'deadbeefcafe',
    });
    expect(sends).toHaveLength(1);
    expect(sends[0].subject).toContain('1 undocumented decision');
    expect(sends[0].subject).toContain('acme/api');
    expect(sends[0].html).toContain('Operation');
    expect(sends[0].html).toContain('GET /a');
    expect(sends[0].html).toContain('src/a.ts:3');
    expect(sends[0].html).toContain('deadbee'); // 7-char short sha
    expect(sends[0].html).toContain('returns &lt;x&gt;'); // escaped reason
  });

  it('sends a conflicts-need-resolution email with the count and a resolve link', async () => {
    const notifier = createEmailNotifier('re_test', 'bot@tc.dev', client);
    await notifier.sendConflictsNeedResolution(['a@x.com', 'b@y.com'], {
      repoFullName: 'acme/api',
      prNumber: 7,
      prUrl: 'https://github.com/acme/api/pull/7',
      openConflicts: 2,
      dashboardUrl: 'https://app.tc.dev/repos/acme-api?pr=7&section=verification&tab=contracts',
    });
    expect(sends.map((s) => s.to)).toEqual([['a@x.com'], ['b@y.com']]);
    expect(sends[0].subject).toContain('2 spec conflicts need resolution');
    expect(sends[0].subject).toContain('acme/api');
    expect(sends[0].html).toContain('https://github.com/acme/api/pull/7');
    // `&` is HTML-escaped to `&amp;` in the rendered href (browsers parse it back).
    expect(sends[0].html).toContain('https://app.tc.dev/repos/acme-api?pr=7&amp;section=verification&amp;tab=contracts');
    expect(sends[0].html).toContain('resolve them in the dashboard');
  });

  it('omits the resolve link when no dashboard url is available', async () => {
    const notifier = createEmailNotifier('re_test', 'bot@tc.dev', client);
    await notifier.sendConflictsNeedResolution(['a@x.com'], {
      repoFullName: 'acme/api',
      prNumber: 7,
      prUrl: 'u',
      openConflicts: 1,
    });
    expect(sends).toHaveLength(1);
    expect(sends[0].subject).toContain('1 spec conflict need'); // singular conflict
    // The PR link is still an anchor; only the "resolve" phrase is plain text.
    expect(sends[0].html).not.toContain('>resolve them in the dashboard</a>');
    expect(sends[0].html).toContain('resolve them in the dashboard');
  });

  it('does not send the new notifications when there are no recipients', async () => {
    const notifier = createEmailNotifier('re_test', 'from@tc.dev', client);
    await notifier.sendInferResult([], {
      repoFullName: 'acme/api',
      prNumber: 7,
      prUrl: 'u',
      decisions: [],
      changedContracts: [],
    });
    await notifier.sendConflictsNeedResolution([], {
      repoFullName: 'acme/api',
      prNumber: 7,
      prUrl: 'u',
      openConflicts: 3,
    });
    expect(sends).toHaveLength(0);
  });
});
