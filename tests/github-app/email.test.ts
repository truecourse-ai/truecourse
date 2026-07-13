import { describe, it, expect, beforeEach } from 'vitest';
import {
  createEmailNotifier,
  type ResendLike,
} from '../../ee/packages/github-app/src/index';

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
  it('sends an infer-result email to each recipient (no cross-disclosure)', async () => {
    const notifier = createEmailNotifier('re_test', 'TrueCourse <bot@tc.dev>', client);
    await notifier.sendInferResult(['a@x.com', 'b@y.com'], {
      repoFullName: 'acme/api',
      prNumber: 7,
      prUrl: 'https://github.com/acme/api/pull/7',
      decisions: [
        { kind: 'Operation', identity: 'GET /a', path: 'src/a.ts', line: 3, reason: 'returns <x>' },
      ],
      commitSha: 'deadbeefcafe',
    });

    // One message per recipient.
    expect(sends).toHaveLength(2);
    expect(sends.map((s) => s.to)).toEqual([['a@x.com'], ['b@y.com']]);
    expect(sends[0].from).toBe('TrueCourse <bot@tc.dev>');
    expect(sends[0].subject).toContain('1 undocumented decision');
    expect(sends[0].subject).toContain('acme/api');
    expect(sends[0].html).toContain('Operation');
    expect(sends[0].html).toContain('GET /a');
    expect(sends[0].html).toContain('src/a.ts:3');
    expect(sends[0].html).toContain('deadbee'); // 7-char short sha
    expect(sends[0].html).toContain('returns &lt;x&gt;'); // escaped reason
  });

  it('does not send when there are no recipients', async () => {
    const notifier = createEmailNotifier('re_test', 'from@tc.dev', client);
    await notifier.sendInferResult([], {
      repoFullName: 'acme/api',
      prNumber: 7,
      prUrl: 'u',
      decisions: [],
    });
    expect(sends).toHaveLength(0);
  });

  it('swallows Resend errors (notifications are best-effort)', async () => {
    result = { error: { message: 'bad key' } };
    const notifier = createEmailNotifier('re_test', 'from@tc.dev', client);
    await expect(
      notifier.sendInferResult(['a@x.com'], {
        repoFullName: 'acme/api',
        prNumber: 7,
        prUrl: 'u',
        decisions: [{ kind: 'Operation', identity: 'GET /a' }],
      }),
    ).resolves.toBeUndefined();
    expect(sends).toHaveLength(1);
  });
});
