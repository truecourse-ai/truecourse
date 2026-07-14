/**
 * Guard-gate email notifier: the Resend-backed sender for the "new failing
 * scenarios on a PR" notification. Driven through the injectable `ResendLike`
 * fake — one message per recipient (addresses undisclosed to each other), a
 * capped scenario list, HTML-escaped interpolation, and the never-throw /
 * one-bad-address-can't-fail-the-batch contract.
 */
import { describe, it, expect } from 'vitest';
import type { GuardScenarioResult } from '@truecourse/shared';
import {
  createEmailNotifier,
  type ResendLike,
} from '../../ee/packages/github-app/src/email';

const FROM = 'TrueCourse <noreply@truecourse.dev>';

function failing(id: string, over: Partial<GuardScenarioResult> = {}): GuardScenarioResult {
  return {
    id,
    title: `scenario ${id}`,
    binds: { doc: 'README.md', section: 'install', fingerprint: 'sha256:f' },
    outcome: 'fail',
    durationMs: 1,
    ...over,
  };
}

/** Captures every send call; `error` lets a chosen address fail. */
function fakeResend(opts: { failOn?: string; throwOn?: string } = {}) {
  const sends: Array<{ from: string; to: string[]; subject: string; html: string }> = [];
  const client: ResendLike = {
    emails: {
      send: async (o) => {
        sends.push(o);
        if (opts.throwOn && o.to.includes(opts.throwOn)) throw new Error('network down');
        if (opts.failOn && o.to.includes(opts.failOn)) {
          return { error: { message: 'invalid recipient' } };
        }
        return { error: null };
      },
    },
  };
  return { client, sends };
}

const email = {
  repoFullName: 'acme/api',
  prNumber: 7,
  prUrl: 'https://github.com/acme/api/pull/7',
};

describe('guard email notifier — sendGuardGateFailure', () => {
  it('sends one message per recipient with the failing-count subject', async () => {
    const { client, sends } = fakeResend();
    const notifier = createEmailNotifier('key', FROM, client);

    await notifier.sendGuardGateFailure(['a@x.com', 'b@x.com'], {
      ...email,
      failing: [failing('s1'), failing('s2')],
    });

    // One message per address — never a shared `to` array.
    expect(sends).toHaveLength(2);
    expect(sends.map((s) => s.to)).toEqual([['a@x.com'], ['b@x.com']]);
    for (const s of sends) {
      expect(s.from).toBe(FROM);
      expect(s.subject).toBe('TrueCourse: 2 new failing scenarios on acme/api #7');
    }
  });

  it('singularizes the subject for exactly one failure', async () => {
    const { client, sends } = fakeResend();
    const notifier = createEmailNotifier('key', FROM, client);

    await notifier.sendGuardGateFailure(['a@x.com'], { ...email, failing: [failing('s1')] });

    expect(sends[0].subject).toBe('TrueCourse: 1 new failing scenario on acme/api #7');
  });

  it('lists each scenario as its title + spec section anchor, and links the PR', async () => {
    const { client, sends } = fakeResend();
    const notifier = createEmailNotifier('key', FROM, client);

    await notifier.sendGuardGateFailure(['a@x.com'], {
      ...email,
      failing: [
        failing('s1', { title: 'boots the CLI', binds: { doc: 'docs/cli.md', section: 'usage', fingerprint: 'f' } }),
      ],
    });

    const html = sends[0].html;
    expect(html).toContain('<a href="https://github.com/acme/api/pull/7">acme/api #7</a>');
    expect(html).toContain('boots the CLI');
    expect(html).toContain('docs/cli.md#usage');
  });

  it('caps the list at 20 with an overflow line', async () => {
    const { client, sends } = fakeResend();
    const notifier = createEmailNotifier('key', FROM, client);
    const many = Array.from({ length: 23 }, (_, i) => failing(`s${i}`));

    await notifier.sendGuardGateFailure(['a@x.com'], { ...email, failing: many });

    const html = sends[0].html;
    expect((html.match(/<li>/g) ?? []).length).toBe(20);
    expect(html).toContain('…and 3 more');
    expect(sends[0].subject).toBe('TrueCourse: 23 new failing scenarios on acme/api #7');
  });

  it('escapes HTML in the scenario title and anchor', async () => {
    const { client, sends } = fakeResend();
    const notifier = createEmailNotifier('key', FROM, client);

    await notifier.sendGuardGateFailure(['a@x.com'], {
      ...email,
      failing: [
        failing('s1', {
          title: '<script>alert("x")</script>',
          binds: { doc: 'a&b.md', section: '<i>', fingerprint: 'f' },
        }),
      ],
    });

    const html = sends[0].html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a&amp;b.md#&lt;i&gt;');
  });

  it('includes the Check-run and dashboard links when provided', async () => {
    const { client, sends } = fakeResend();
    const notifier = createEmailNotifier('key', FROM, client);

    await notifier.sendGuardGateFailure(['a@x.com'], {
      ...email,
      failing: [failing('s1')],
      checkUrl: 'https://github.com/acme/api/pull/7/checks',
      dashboardUrl: 'https://app/repos/acme-api?pr=7&section=guard',
    });

    const html = sends[0].html;
    expect(html).toContain('https://github.com/acme/api/pull/7/checks');
    expect(html).toContain('https://app/repos/acme-api?pr=7&amp;section=guard');
  });

  it('one failing address does not stop the rest, and the sender never throws', async () => {
    const { client, sends } = fakeResend({ failOn: 'bad@x.com', throwOn: 'boom@x.com' });
    const notifier = createEmailNotifier('key', FROM, client);

    await expect(
      notifier.sendGuardGateFailure(['bad@x.com', 'boom@x.com', 'ok@x.com'], {
        ...email,
        failing: [failing('s1')],
      }),
    ).resolves.toBeUndefined();

    // All three attempted despite the first two misbehaving.
    expect(sends.map((s) => s.to[0])).toEqual(['bad@x.com', 'boom@x.com', 'ok@x.com']);
  });

  it('is a no-op for an empty recipient list', async () => {
    const { client, sends } = fakeResend();
    const notifier = createEmailNotifier('key', FROM, client);

    await notifier.sendGuardGateFailure([], { ...email, failing: [failing('s1')] });

    expect(sends).toHaveLength(0);
  });
});

describe('guard email notifier — sendGuardConflictsBlocked', () => {
  it('sends one message per recipient with the blocked-count subject', async () => {
    const { client, sends } = fakeResend();
    const notifier = createEmailNotifier('key', FROM, client);

    await notifier.sendGuardConflictsBlocked(['a@x.com', 'b@x.com'], {
      repoFullName: 'acme/api',
      conflicts: 2,
    });

    expect(sends).toHaveLength(2);
    expect(sends.map((s) => s.to)).toEqual([['a@x.com'], ['b@x.com']]);
    for (const s of sends) {
      expect(s.from).toBe(FROM);
      expect(s.subject).toBe(
        'TrueCourse: scenario generation blocked on acme/api — 2 spec conflicts',
      );
    }
  });

  it('singularizes the subject for exactly one conflict', async () => {
    const { client, sends } = fakeResend();
    const notifier = createEmailNotifier('key', FROM, client);

    await notifier.sendGuardConflictsBlocked(['a@x.com'], {
      repoFullName: 'acme/api',
      conflicts: 1,
    });

    expect(sends[0].subject).toBe(
      'TrueCourse: scenario generation blocked on acme/api — 1 spec conflict',
    );
  });

  it('names the count and links the Spec Guard Coverage tab when a dashboard url is given', async () => {
    const { client, sends } = fakeResend();
    const notifier = createEmailNotifier('key', FROM, client);

    await notifier.sendGuardConflictsBlocked(['a@x.com'], {
      repoFullName: 'acme/api',
      conflicts: 3,
      dashboardUrl: 'https://app/repos/acme-api?section=guard&tab=coverage',
    });

    const html = sends[0].html;
    expect(html).toContain('3 open spec conflicts');
    expect(html).toContain('https://app/repos/acme-api?section=guard&amp;tab=coverage');
  });

  it('omits the link when no dashboard url is derivable', async () => {
    const { client, sends } = fakeResend();
    const notifier = createEmailNotifier('key', FROM, client);

    await notifier.sendGuardConflictsBlocked(['a@x.com'], {
      repoFullName: 'acme/api',
      conflicts: 1,
    });

    expect(sends[0].html).not.toContain('<a href');
  });

  it('escapes HTML in the repo name', async () => {
    const { client, sends } = fakeResend();
    const notifier = createEmailNotifier('key', FROM, client);

    await notifier.sendGuardConflictsBlocked(['a@x.com'], {
      repoFullName: 'acme/<b>api</b>',
      conflicts: 1,
    });

    const html = sends[0].html;
    expect(html).not.toContain('<b>api</b>');
    expect(html).toContain('acme/&lt;b&gt;api&lt;/b&gt;');
  });

  it('one failing address does not stop the rest, and the sender never throws', async () => {
    const { client, sends } = fakeResend({ failOn: 'bad@x.com', throwOn: 'boom@x.com' });
    const notifier = createEmailNotifier('key', FROM, client);

    await expect(
      notifier.sendGuardConflictsBlocked(['bad@x.com', 'boom@x.com', 'ok@x.com'], {
        repoFullName: 'acme/api',
        conflicts: 2,
      }),
    ).resolves.toBeUndefined();

    expect(sends.map((s) => s.to[0])).toEqual(['bad@x.com', 'boom@x.com', 'ok@x.com']);
  });

  it('is a no-op for an empty recipient list', async () => {
    const { client, sends } = fakeResend();
    const notifier = createEmailNotifier('key', FROM, client);

    await notifier.sendGuardConflictsBlocked([], { repoFullName: 'acme/api', conflicts: 1 });

    expect(sends).toHaveLength(0);
  });
});
