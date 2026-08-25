/**
 * The chat fold (transcript-model): machinery is dropped, the agent's intro
 * is synthesized per kind, runs of one tool phrase into a single did-bubble,
 * a user answer becomes a right-side row, and an overlap outcome lifts its
 * findings into cards with a Done close carrying facts in words.
 */

import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@truecourse/agent-loop';
import { toChatRows } from '@/components/sessions/transcript-model';

let seq = 0;
const at = (s: number): string => new Date(1700000000000 + s * 1000).toISOString();

function ev(body: Omit<SessionEvent, 'seq' | 'ts'>, second = seq): SessionEvent {
  return { ...body, seq: seq++, ts: at(second) } as SessionEvent;
}

const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0, costSource: 'unpriced' as const };
const call = (name: string): Omit<SessionEvent, 'seq' | 'ts'> =>
  ({ type: 'assistant-turn', toolCall: { name, args: {} }, usage }) as never;
const result = (toolName: string): Omit<SessionEvent, 'seq' | 'ts'> =>
  ({ type: 'tool-result', toolName, content: 'ok' }) as never;

describe('toChatRows', () => {
  it('synthesizes the intro, drops machinery, and keeps actor messages on the user side', () => {
    seq = 0;
    const rows = toChatRows([
      ev({ type: 'session-start', kind: 'spec-scan.overlap', workItem: 'signing-certificate', systemPrompt: 'SECRET', toolNames: [] }),
      ev({ type: 'user-message', content: 'the briefing' }),
      ev({ type: 'user-message', content: '[budget] resume grant', }),
      ev({ type: 'resume-grant', grant: 1, of: 2 }),
      ev({ type: 're-ask', invalid: 'x', reason: 'bad args' }),
      ev({ type: 'user-message', content: 'please recheck', actor: 'sarkis' }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['agent-text', 'user']);
    expect(rows[0]).toMatchObject({ text: "I'm reviewing signing-certificate, reading its docs side by side to catch any claims that disagree." });
    expect(rows[1]).toMatchObject({ label: 'sarkis', text: 'please recheck' });
    expect(JSON.stringify(rows)).not.toContain('SECRET');
  });

  it('folds a run of one tool into a single phrased did-bubble, split by tool change or reply', () => {
    seq = 0;
    const rows = toChatRows([
      ev(call('read_section'), 0),
      ev(result('read_section'), 20),
      ev(call('read_section'), 21),
      ev(result('read_section'), 58),
      ev(call('check_findings'), 58),
      ev(result('check_findings'), 60),
      ev({ type: 'assistant-turn', text: 'Found a mismatch.', usage }),
      ev(call('read_section')),
      ev(result('read_section')),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['action', 'action', 'agent-text', 'action']);
    expect(rows[0]).toMatchObject({ phrase: 'I read through 2 sections of the docs', duration: '58s', inFlight: false });
    expect(rows[1]).toMatchObject({ phrase: 'I double-checked my findings', inFlight: false });
    expect(rows[3]).toMatchObject({ phrase: 'I read one section of the docs' });
  });

  it('marks the open did-bubble in flight until its result lands', () => {
    seq = 0;
    const rows = toChatRows([ev(call('read_section'))]);
    expect(rows[0]).toMatchObject({ kind: 'action', phrase: 'I read one section of the docs', inFlight: true });
  });

  it('renders a user answer as a right-side row and a policy answer as a note', () => {
    seq = 0;
    const question = { id: 'q1', header: 'Winner', question: 'Which doc wins?', options: [{ label: 'tips.mdx' }], multiSelect: false };
    const rows = toChatRows([
      ev({ type: 'question-asked', question }),
      ev({ type: 'question-resolved', questionId: 'q1', answer: 'tips.mdx', resolvedBy: 'user' }),
      ev({ type: 'question-asked', question: { ...question, id: 'q2' } }),
      ev({ type: 'question-resolved', questionId: 'q2', answer: 'defaults', resolvedBy: 'policy' }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['question', 'user', 'question', 'note']);
    expect(rows[0]).toMatchObject({ answer: 'tips.mdx', resolvedBy: 'user' });
    expect(rows[1]).toMatchObject({ text: 'tips.mdx' });
    expect(rows[3]).toMatchObject({ text: 'No answer arrived, so the run went ahead with defaults' });
  });

  it('speaks the scan-scope session in its own words and hides the outcome transport', () => {
    seq = 0;
    const rows = toChatRows([
      ev({ type: 'session-start', kind: 'spec-scan.orchestrate', workItem: 'scan-scope', systemPrompt: 'x', toolNames: [] }),
      ev(call('list_universe')),
      ev(result('list_universe')),
      ev(call('doc_outline')),
      ev(result('doc_outline')),
      ev(call('doc_outline')),
      ev(result('doc_outline')),
      // The reserved outcome tool is the result's transport, never a step.
      ev({ type: 'assistant-turn', toolCall: { name: 'outcome', args: { verdicts: [] } }, usage }),
      ev({ type: 'tool-result', toolName: 'outcome', content: 'outcome recorded' }),
      ev({
        type: 'outcome',
        value: {
          verdicts: [
            { path: 'docs', verdict: 'keep', reason: 'product docs', decidedAt: 'x' },
            { path: 'apps/docs', verdict: 'keep', reason: 'reference', decidedAt: 'x' },
            { path: 'docs/legal', verdict: 'exclude', reason: 'boilerplate, nothing testable', decidedAt: 'x' },
          ],
          instructions: [],
        },
      }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['agent-text', 'action', 'action', 'close']);
    expect(rows[0]).toMatchObject({ text: expect.stringContaining("working out what it should cover") });
    expect(rows[1]).toMatchObject({ phrase: 'I looked over the doc tree to see the folders and how many docs each holds' });
    expect(rows[2]).toMatchObject({
      phrase: 'I skimmed the outlines of 2 docs, sampling each folder before ruling anything in or out',
      inFlight: false,
    });
    const close = rows[3];
    if (close.kind !== 'close') throw new Error('unreachable');
    expect(close.facts).toEqual([
      "I set the scan's scope: 2 of 3 doc subtrees kept",
      'left out docs/legal: boilerplate, nothing testable',
      'no extra instructions for the scan sessions',
    ]);
  });

  it('lifts overlap findings into cards and closes with facts in words, never raw JSON', () => {
    seq = 0;
    const rows = toChatRows([
      ev({
        type: 'outcome',
        value: {
          overlaps: [
            {
              docs: ['docs/self-hosting/tips.mdx', 'docs/signing-certificate/troubleshooting.mdx'],
              note: 'The two docs give different macOS base64 commands.',
              sections: [
                { doc: 'docs/self-hosting/tips.mdx', heading: 'Base64', quote: 'base64 -i certificate.p12' },
                { doc: 'docs/signing-certificate/troubleshooting.mdx', heading: null, quote: "base64 -i certificate.p12 | tr -d '\\n'" },
              ],
              review: {
                explanation: 'x',
                recommendation: { action: 'pick-b', rationale: 'strips line breaks', confidence: 'medium' },
              },
            },
          ],
          notReached: [],
          sectionsOpened: 35,
          uncheckedPairs: [],
        },
      }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['finding', 'close']);
    const [finding, close] = rows;
    if (finding.kind !== 'finding' || close.kind !== 'close') throw new Error('unreachable');
    expect(finding.finding.claim).toBe('The two docs give different macOS base64 commands.');
    expect(finding.finding.quotes.map((q) => q.doc)).toEqual([
      'self-hosting/tips.mdx',
      'signing-certificate/troubleshooting.mdx',
    ]);
    expect(finding.finding.recommendation).toMatchObject({
      doc: 'signing-certificate/troubleshooting.mdx',
      rationale: 'strips line breaks',
      confidence: 'medium',
    });
    // The dispute identity carries FULL paths + anchors + quotes — the exact
    // key postSpecConflictResolution takes, so chat verdicts match the corpus.
    expect(finding.finding.dispute).toEqual({
      docA: 'docs/self-hosting/tips.mdx',
      anchorA: 'Base64',
      quoteA: 'base64 -i certificate.p12',
      docB: 'docs/signing-certificate/troubleshooting.mdx',
      anchorB: null,
      quoteB: "base64 -i certificate.p12 | tr -d '\\n'",
    });
    expect(close).toMatchObject({ tone: 'ok', headline: "All done here. Here's where things landed." });
    expect(close.facts).toEqual(['1 finding recorded', 'not reached: 0', 'sections opened: 35', 'unchecked pairs: 0']);
  });
});
