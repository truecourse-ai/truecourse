/**
 * The rows of the Claims view: one row per claim the scan read, however many
 * repositories hold it, its status the worst of theirs, every repository's
 * flows kept with the repository they belong to, and Not linked for a claim
 * none holds.
 */

import { describe, it, expect } from 'vitest';
import { composeContextClaims, NOT_LINKED_CLAIM_REASON, type ContextClaimReading } from '@truecourse/core/services/context';
import type { Claim, ClaimsFile, GuardClaimFlow, GuardClaimRow, GuardClaimsView } from '@truecourse/shared';

const DOC = 'context/repo-acme-web/docs/refunds.md';

function flow(flowId: string, status: GuardClaimFlow['status']): GuardClaimFlow {
  return {
    flowId,
    title: flowId,
    status,
    epic: false,
    manual: false,
    milestoneOrders: [1],
    milestoneCount: 1,
    surfaces: [],
  };
}

function claim(id: string, status: GuardClaimRow['status'], flows: GuardClaimFlow[], reason?: string): GuardClaimRow {
  return {
    id,
    doc: DOC,
    statement: `statement ${id}`,
    sentences: ['s1'],
    status,
    ...(reason ? { reason } : {}),
    dismissed: status === 'dismissed',
    flows,
    scenarios: [],
  };
}

function view(claims: GuardClaimRow[]): GuardClaimsView {
  return {
    extracted: true,
    generatedAt: null,
    claims,
    untestable: [],
    totals: { claims: claims.length, byStatus: {}, dismissed: 0, untestable: 0 },
  };
}

function scanned(id: string, testable: Claim['testable'] = true): Claim {
  return { id, doc: DOC, sentences: ['s1'], subject: 'refunds', statement: `statement ${id}`, areas: [], testable };
}

function file(...claims: Claim[]): ClaimsFile {
  return { version: 1, generatedAt: '2026-10-08T00:00:00.000Z', claims };
}

function reading(repo: string, v: GuardClaimsView, dismissals: ContextClaimReading['dismissals'] = []): ContextClaimReading {
  return { repo, view: v, dismissals };
}

describe('composeContextClaims', () => {
  it('folds a claim two repositories hold into one row, worst status first', () => {
    const out = composeContextClaims(file(scanned('c1')), [
      reading('web', view([claim('c1', 'pass', [flow('refund', 'pass')])])),
      reading('api', view([claim('c1', 'blocked-on', [flow('refund-api', 'blocked-on')], 'needs a key')])),
    ]);
    expect(out.claims).toHaveLength(1);
    const [row] = out.claims;
    expect(row!.status).toBe('blocked-on');
    expect(row!.reason).toBe('needs a key');
    expect(row!.repositories).toEqual(['web', 'api']);
    expect(row!.flows.map((f) => [f.repo, f.flowId])).toEqual([
      ['web', 'refund'],
      ['api', 'refund-api'],
    ]);
  });

  it('keeps the better reading out of the words behind a worse one', () => {
    const out = composeContextClaims(file(scanned('c1')), [
      reading('web', view([claim('c1', 'fail', [flow('refund', 'fail')], 'refused the refund')])),
      reading('api', view([claim('c1', 'blocked-on', [], 'needs a key')])),
    ]);
    expect(out.claims[0]!.status).toBe('fail');
    expect(out.claims[0]!.reason).toBe('refused the refund');
  });

  it('carries the dismissal a repository recorded', () => {
    const dismissal = { claimId: 'c1', dismissedAt: '2026-10-08T00:00:00.000Z', auto: true, reason: 'triage' };
    const out = composeContextClaims(file(scanned('c1')), [
      reading('web', view([claim('c1', 'pass', [])])),
      reading('api', view([claim('c1', 'dismissed', [])]), [dismissal]),
    ]);
    expect(out.claims[0]!.dismissal).toEqual(dismissal);
  });

  it('lists every claim the scan read, Not linked where no repository holds it', () => {
    const out = composeContextClaims(file(scanned('c1'), scanned('c2'), scanned('u1', { reason: 'hedge' })), [
      reading('web', view([claim('c1', 'pass', []), claim('gone', 'fail', [])])),
    ]);
    expect(out.claims.map((c) => [c.id, c.status])).toEqual([
      ['c1', 'pass'],
      ['c2', 'not-linked'],
    ]);
    expect(out.claims[1]).toMatchObject({ reason: NOT_LINKED_CLAIM_REASON, repositories: [], flows: [] });
    expect(out.untestable).toEqual([{ id: 'u1', doc: DOC, statement: 'statement u1', reason: 'hedge' }]);
  });

  it('answers empty until a scan has read claims', () => {
    expect(composeContextClaims(null, [])).toEqual({ extracted: false, claims: [], untestable: [] });
  });
});
