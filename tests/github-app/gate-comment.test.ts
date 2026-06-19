import { describe, it, expect } from 'vitest';
import {
  GATE_MARKER,
  isGateComment,
  renderGateComment,
  gateCheckOutput,
  inlineDriftBody,
  type GateDecision,
} from '../../ee/packages/github-app/src/index';
import {
  driftContentKey,
  type EnrichedDrift,
} from '@truecourse/core/lib/drift-enrichment';

function drift(over: Record<string, unknown> = {}): any {
  return {
    id: 'x',
    artifactRef: { type: 'Operation', identity: 'GET /a' },
    obligationKey: 'ob1',
    severity: 'high',
    filePath: 'src/a.ts',
    lineStart: 10,
    lineEnd: 12,
    message: 'response missing field email',
    ...over,
  };
}

const pass: GateDecision = { conclusion: 'success', added: [], resolved: [], belowThreshold: [] };
const passResolved: GateDecision = { conclusion: 'success', added: [], resolved: [drift()], belowThreshold: [] };
const fail: GateDecision = { conclusion: 'failure', added: [drift()], resolved: [], belowThreshold: [] };
const advisory: GateDecision = { conclusion: 'neutral', added: [drift()], resolved: [], belowThreshold: [] };
const noContracts: GateDecision = { conclusion: 'neutral', added: [], resolved: [], belowThreshold: [], neutralReason: 'no-contracts' };
const noBaseline: GateDecision = { conclusion: 'neutral', added: [], resolved: [], belowThreshold: [], neutralReason: 'no-baseline' };
const conflicts: GateDecision = { conclusion: 'neutral', added: [], resolved: [], belowThreshold: [], neutralReason: 'unresolved-conflicts', unresolvedConflicts: 2 };
const passBelow: GateDecision = { conclusion: 'success', added: [], resolved: [], belowThreshold: [drift(), drift()] };

describe('renderGateComment', () => {
  it('all states carry the gate marker', () => {
    for (const d of [pass, fail, advisory, noContracts]) {
      expect(renderGateComment(d)).toContain(GATE_MARKER);
      expect(isGateComment(renderGateComment(d))).toBe(true);
    }
  });

  it('passed reads cleanly and notes resolved drift', () => {
    expect(renderGateComment(pass)).toContain('drift gate passed');
    expect(renderGateComment(passResolved)).toContain('resolved');
  });

  it('failure lists drift and frames it as blocking', () => {
    const body = renderGateComment(fail);
    expect(body).toContain('1 new drift');
    expect(body).toContain('response missing field email');
    expect(body).toContain('src/a.ts:10');
    expect(body).not.toContain('advisory');
  });

  it('advisory frames new drift as non-blocking', () => {
    const body = renderGateComment(advisory);
    expect(body.toLowerCase()).toContain('advisory');
  });

  it('no-contracts explains there is nothing to verify', () => {
    expect(renderGateComment(noContracts)).toContain('no contracts');
  });

  it('no-baseline explains the baseline is not established', () => {
    expect(renderGateComment(noBaseline)).toContain('baseline not established');
  });

  it('unresolved-conflicts asks for resolution and counts the conflicts', () => {
    const body = renderGateComment(conflicts);
    expect(body).toContain('2 unresolved conflicts');
    expect(body).toContain('resolve them in the dashboard');
    // Without a URL the prose is plain text, no markdown link.
    expect(body).not.toContain('](');
  });

  it('unresolved-conflicts links to the dashboard when a url is provided', () => {
    const body = renderGateComment(conflicts, {
      conflictsUrl: 'https://app.tc.dev/repos/acme-api?pr=7&section=verification&tab=contracts',
    });
    expect(body).toContain('[resolve them in the dashboard](https://app.tc.dev/repos/acme-api?pr=7&section=verification&tab=contracts)');
  });

  it('surfaces below-threshold drift on a passing gate', () => {
    expect(renderGateComment(passBelow)).toContain('2 lower-severity drift not gated');
  });
});

describe('gateCheckOutput', () => {
  it('summarizes the conclusion', () => {
    expect(gateCheckOutput(pass).title).toContain('No new drift');
    expect(gateCheckOutput(fail).title).toContain('1 new contract drift');
    expect(gateCheckOutput(noContracts).title).toContain('No contracts');
    expect(gateCheckOutput(conflicts).title).toContain('Spec conflicts need resolution');
    expect(gateCheckOutput(conflicts).summary).toContain('2 unresolved conflicts');
  });
});

describe('inlineDriftBody', () => {
  it('includes severity, message, and spec/code sides', () => {
    const body = inlineDriftBody(drift({ specSide: 'has email', codeSide: 'no email' }));
    expect(body).toContain('high');
    expect(body).toContain('response missing field email');
    expect(body).toContain('has email');
    expect(body).toContain('no email');
  });
});

describe('enrichment (feat 2)', () => {
  const enrichedFixture: EnrichedDrift = {
    specReadable: 'The spec requires the response to include an email field.',
    codeReadable: 'The handler returns the user without an email field.',
    summary: 'Spec requires an email field on the response, but the code omits it.',
  };

  function enrichmentFor(d: ReturnType<typeof drift>): Map<string, EnrichedDrift> {
    return new Map([[driftContentKey(d as any), enrichedFixture]]);
  }

  it('renderGateComment uses the readable summary when enrichment is supplied', () => {
    const d = drift({ specSide: 'has email', codeSide: 'no email' });
    const decision: GateDecision = { conclusion: 'failure', added: [d], resolved: [], belowThreshold: [] };
    const body = renderGateComment(decision, { enriched: enrichmentFor(d) });
    expect(body).toContain(enrichedFixture.summary);
    // The structured message is replaced in the human line by the summary.
    expect(body).not.toContain('response missing field email');
  });

  it('renderGateComment falls back to the structured message without enrichment', () => {
    const d = drift();
    const decision: GateDecision = { conclusion: 'failure', added: [d], resolved: [], belowThreshold: [] };
    const body = renderGateComment(decision);
    expect(body).toContain('response missing field email');
    expect(body).not.toContain(enrichedFixture.summary);
  });

  it('renderGateComment falls back per-drift when the map lacks an entry', () => {
    const d = drift();
    const decision: GateDecision = { conclusion: 'failure', added: [d], resolved: [], belowThreshold: [] };
    // Empty map (e.g. enrichment failed for this drift) → structured.
    const body = renderGateComment(decision, { enriched: new Map() });
    expect(body).toContain('response missing field email');
  });

  it('inlineDriftBody uses readable prose when enriched, keeping the structured message', () => {
    const d = drift({ specSide: 'has email', codeSide: 'no email' });
    const body = inlineDriftBody(d, enrichmentFor(d));
    expect(body).toContain('response missing field email'); // structured message kept as anchor
    expect(body).toContain(enrichedFixture.summary);
    expect(body).toContain('Spec expectation:');
    expect(body).toContain(enrichedFixture.specReadable);
    expect(body).toContain('Code observation:');
    expect(body).toContain(enrichedFixture.codeReadable);
  });

  it('inlineDriftBody falls back to structured snippets without enrichment', () => {
    const body = inlineDriftBody(drift({ specSide: 'has email', codeSide: 'no email' }));
    expect(body).toContain('**Spec:** has email');
    expect(body).toContain('**Code:** no email');
    expect(body).not.toContain('Spec expectation:');
  });
});
