/**
 * The capability-noun → plain-English table behind a blocked flow's ONE sentence.
 * Pure and ordered, so it gets a fast unit test rather than a render: the ordering
 * IS the behavior (item 57 put the third-party row above the running-service row,
 * or `external-service` reads as "needs a running service" — the opposite triage).
 */

import { describe, it, expect } from 'vitest';
import type { GuardFlowGap } from '@truecourse/shared';
import { guardGapNeed } from '@/lib/guard-flow-status';

const blockedOn = (capabilities: string[]): GuardFlowGap => ({
  kind: 'blocked-on',
  surface: 'api',
  reason: `blocked on ${capabilities.join(', ')}: the claim`,
  label: 'blocked',
});

describe('guardGapNeed — blocked-on capabilities', () => {
  it('reads a generic third-party noun as an external service, never as a local one', () => {
    for (const noun of ['external-service', 'external service', 'third-party', 'saas', 'integration', 'upstream']) {
      expect(guardGapNeed(blockedOn([noun]))).toBe('needs an external service (or a stub)');
    }
  });

  it('still reads a LOCAL service as a running service', () => {
    expect(guardGapNeed(blockedOn(['service']))).toBe('needs a running service');
    expect(guardGapNeed(blockedOn(['container']))).toBe('needs a running service');
  });

  it('names a detected service verbatim — no row needed per third party', () => {
    expect(guardGapNeed(blockedOn(['stripe']))).toBe('needs stripe');
    expect(guardGapNeed(blockedOn(['stripe', 'sendgrid']))).toBe('needs stripe and sendgrid');
  });

  it('keeps the pre-existing rows intact', () => {
    expect(guardGapNeed(blockedOn(['credentials']))).toBe('needs credentials');
    expect(guardGapNeed(blockedOn(['db']))).toBe('needs a database');
    expect(guardGapNeed(blockedOn(['network']))).toBe('needs network access');
  });
});
