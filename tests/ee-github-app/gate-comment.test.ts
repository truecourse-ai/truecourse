import { describe, it, expect } from 'vitest';
import {
  GATE_MARKER,
  isGateComment,
  renderGateComment,
  cqCheckOutput,
  type CodeQualityDecision,
} from '../../ee/packages/github-app/src/index';

function violation(over: Record<string, unknown> = {}): any {
  return { id: 'v', ruleKey: 'r', severity: 'high', title: 'God object', filePath: 'src/a.ts', ...over };
}

const pass: CodeQualityDecision = { conclusion: 'success', added: [], belowThreshold: [], total: 0 };
const fail: CodeQualityDecision = { conclusion: 'failure', added: [violation()], belowThreshold: [], total: 1 };
const advisory: CodeQualityDecision = { conclusion: 'neutral', added: [violation()], belowThreshold: [], total: 1 };
const below: CodeQualityDecision = { conclusion: 'success', added: [], belowThreshold: [violation({ severity: 'low' })], total: 1 };
const noBaseline: CodeQualityDecision = { conclusion: 'neutral', added: [], belowThreshold: [], total: 0, neutralReason: 'no-baseline' };

describe('renderGateComment (Code Quality)', () => {
  it('all states carry the gate marker', () => {
    for (const d of [pass, fail, advisory, noBaseline]) {
      expect(renderGateComment(d)).toContain(GATE_MARKER);
      expect(isGateComment(renderGateComment(d))).toBe(true);
    }
  });

  it('passing reads cleanly with no violation list', () => {
    const body = renderGateComment(pass);
    expect(body).toContain('Code Quality');
    expect(body).toContain('no new violations');
    expect(body).not.toContain('---');
  });

  it('failure lists the new violations and frames it as blocking', () => {
    const body = renderGateComment(fail);
    expect(body).toContain('1 new violation');
    expect(body).toContain('God object');
    expect(body).toContain('src/a.ts');
    expect(body.toLowerCase()).not.toContain('advisory');
    expect(body).toContain('Resolve the new violations');
  });

  it('advisory frames new violations as non-blocking', () => {
    expect(renderGateComment(advisory).toLowerCase()).toContain('advisory');
  });

  it('below-threshold-only passes and summarizes them', () => {
    const body = renderGateComment(below);
    expect(body).toContain('below threshold');
  });

  it('no-baseline explains there is nothing to compare against', () => {
    expect(renderGateComment(noBaseline)).toContain('no baseline analysis yet');
  });

  it('links to the Code Quality view when a url is provided', () => {
    const body = renderGateComment(fail, {
      codeQualityUrl: 'https://app.tc.dev/repos/acme-api?pr=7&section=codequality&tab=analytics',
    });
    expect(body).toContain('[View Code Quality →](https://app.tc.dev/repos/acme-api?pr=7&section=codequality&tab=analytics)');
  });
});

describe('cqCheckOutput', () => {
  it('summarizes the conclusion', () => {
    expect(cqCheckOutput(pass).title).toContain('No new violations');
    expect(cqCheckOutput(fail).title).toContain('1 new code-quality violation');
    expect(cqCheckOutput(fail).summary).toContain('God object');
    expect(cqCheckOutput(noBaseline).title).toContain('No baseline analysis yet');
  });
});
