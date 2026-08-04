/**
 * The capability-noun → plain-English table behind a blocked flow's ONE sentence.
 * Pure and ordered, so it gets a fast unit test rather than a render: the ordering
 * IS the behavior (the third-party row sits above the running-service row, or
 * `external-service` reads as "needs a running service" — the opposite triage).
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

  // The enumerated `missing-data` noun: "the row doesn't exist" stops hiding
  // inside free text.
  it('reads the missing-data nouns as seed data', () => {
    for (const noun of ['missing-data', 'missing data', 'seed', 'seed data', 'fixture', 'data']) {
      expect(guardGapNeed(blockedOn([noun]))).toBe('needs seed data');
    }
  });

  it('keeps db-infrastructure nouns on the database row — the ordering IS the behavior', () => {
    // `database`/`datastore` must not fall through to the data row (the substring is
    // there; the word boundary and the row ordering are what keep them apart).
    expect(guardGapNeed(blockedOn(['database']))).toBe('needs a database');
    expect(guardGapNeed(blockedOn(['datastore']))).toBe('needs a database');
    // And a noun that merely CONTAINS "data" is not a seeding gap.
    expect(guardGapNeed(blockedOn(['metadata']))).toBe('needs metadata');
  });

  it('names the missing entity next to the noun — the count and the fix in one sentence', () => {
    expect(guardGapNeed(blockedOn(['missing-data', 'an already-cancelled booking']))).toBe(
      'needs seed data and an already-cancelled booking',
    );
  });

  it('keeps the pre-existing rows intact', () => {
    expect(guardGapNeed(blockedOn(['credentials']))).toBe('needs credentials');
    expect(guardGapNeed(blockedOn(['db']))).toBe('needs a database');
    expect(guardGapNeed(blockedOn(['network']))).toBe('needs network access');
  });
});
