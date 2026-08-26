/**
 * The chat fold (transcript-model): machinery is dropped, the session's own
 * declared copy does the talking (its intro, its per-tool wording, its outcome
 * blocks), runs of one tool phrase into a single did-bubble, a user answer
 * becomes a right-side row. Nothing here knows a session kind: a transcript
 * that declares nothing degrades to generic phrasing and key/value facts.
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
  it('speaks the intro the session declared, drops machinery, and keeps actor messages on the user side', () => {
    seq = 0;
    const rows = toChatRows([
      ev({
        type: 'session-start',
        kind: 'a-kind',
        workItem: 'signing-certificate',
        systemPrompt: 'SECRET',
        toolNames: [],
        display: {
          intro:
            "I'm reviewing signing-certificate, reading its docs side by side to catch any claims that disagree.",
        },
      }),
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

  it('opens with a generic line when the session declares no intro', () => {
    seq = 0;
    const rows = toChatRows([
      ev({ type: 'session-start', kind: 'a-kind', workItem: 'docs/guides/booking.md', systemPrompt: 'x', toolNames: [] }),
    ]);
    expect(rows[0]).toMatchObject({
      kind: 'agent-text',
      text: "I'm getting started on docs/guides/booking.md.",
    });
  });

  it('folds a run of one tool into a single phrased did-bubble, split by tool change or reply', () => {
    seq = 0;
    const rows = toChatRows([
      ev({
        type: 'session-start',
        kind: 'a-kind',
        workItem: 'signing-certificate',
        systemPrompt: 'x',
        toolNames: ['read_section', 'check_findings'],
        display: {
          tools: {
            read_section: {
              one: 'I read one section of the docs',
              many: 'I read through {n} sections of the docs',
            },
            check_findings: {
              one: 'I double-checked my findings',
              many: 'I double-checked my findings, {n} passes',
            },
          },
        },
      }),
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
    expect(rows.map((r) => r.kind)).toEqual(['agent-text', 'action', 'action', 'agent-text', 'action']);
    expect(rows[1]).toMatchObject({ phrase: 'I read through 2 sections of the docs', duration: '58s', inFlight: false });
    expect(rows[2]).toMatchObject({ phrase: 'I double-checked my findings', inFlight: false });
    expect(rows[4]).toMatchObject({ phrase: 'I read one section of the docs' });
  });

  it('humanizes the tool name when the session declared no wording for it', () => {
    seq = 0;
    const rows = toChatRows([
      ev(call('read_section')),
      ev(result('read_section')),
      ev(call('read_section')),
      ev(result('read_section')),
      ev(call('check_settlement')),
      ev(result('check_settlement')),
    ]);
    expect(rows[0]).toMatchObject({ kind: 'action', phrase: 'I ran read section 2 times' });
    expect(rows[1]).toMatchObject({ kind: 'action', phrase: 'I ran check settlement' });
  });

  it('marks the open did-bubble in flight until its result lands', () => {
    seq = 0;
    const rows = toChatRows([ev(call('read_section'))]);
    expect(rows[0]).toMatchObject({ kind: 'action', phrase: 'I ran read section', inFlight: true });
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
  it("renders the outcome's own blocks and hides the outcome transport", () => {
    seq = 0;
    const rows = toChatRows([
      // The reserved outcome tool is the result's transport, never a step.
      ev({ type: 'assistant-turn', toolCall: { name: 'outcome', args: { overlaps: [] } }, usage }),
      ev({ type: 'tool-result', toolName: 'outcome', content: 'outcome recorded' }),
      ev({
        type: 'outcome',
        value: { overlaps: [], notReached: [] },
        display: {
          blocks: [
            { kind: 'text', text: 'I read both docs end to end.' },
            {
              kind: 'finding',
              claim: 'The two docs give different macOS base64 commands.',
              quotes: [
                { doc: 'self-hosting/tips.mdx', heading: 'Base64', quote: 'base64 -i certificate.p12' },
                { doc: 'signing-certificate/troubleshooting.mdx', quote: "base64 -i certificate.p12 | tr -d '\\n'" },
              ],
              recommendation: {
                doc: 'signing-certificate/troubleshooting.mdx',
                rationale: 'strips line breaks',
                confidence: 'medium',
              },
              dispute: {
                docA: 'docs/self-hosting/tips.mdx',
                anchorA: 'Base64',
                quoteA: 'base64 -i certificate.p12',
                docB: 'docs/signing-certificate/troubleshooting.mdx',
                anchorB: null,
                quoteB: "base64 -i certificate.p12 | tr -d '\\n'",
              },
            },
            { kind: 'facts', lines: ['1 finding recorded', 'sections opened: 35'] },
          ],
        },
      }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['agent-text', 'finding', 'close']);
    const [text, finding, close] = rows;
    if (text.kind !== 'agent-text' || finding.kind !== 'finding' || close.kind !== 'close') {
      throw new Error('unreachable');
    }
    expect(text.text).toBe('I read both docs end to end.');
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
    // The dispute identity travels through untouched — the exact key
    // postSpecConflictResolution takes, so chat verdicts match the corpus.
    expect(finding.finding.dispute).toEqual({
      docA: 'docs/self-hosting/tips.mdx',
      anchorA: 'Base64',
      quoteA: 'base64 -i certificate.p12',
      docB: 'docs/signing-certificate/troubleshooting.mdx',
      anchorB: null,
      quoteB: "base64 -i certificate.p12 | tr -d '\\n'",
    });
    expect(close).toMatchObject({ tone: 'ok', headline: "All done here. Here's where things landed." });
    expect(close.facts).toEqual(['1 finding recorded', 'sections opened: 35']);
  });

  it('falls back to key/value facts for an outcome that carries no display', () => {
    seq = 0;
    const rows = toChatRows([
      ev({
        type: 'outcome',
        value: { notReached: [], sectionsOpened: 35, uncheckedPairs: [] },
      }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['close']);
    const close = rows[0];
    if (close.kind !== 'close') throw new Error('unreachable');
    expect(close.facts).toEqual(['not reached: 0', 'sections opened: 35', 'unchecked pairs: 0']);
  });

  it('stays silent about a presenter that threw, and still states the facts', () => {
    seq = 0;
    const rows = toChatRows([
      ev({ type: 'outcome', value: { kept: true }, displayError: 'TypeError: cannot read areas of undefined' }),
    ]);
    const close = rows[0];
    if (close.kind !== 'close') throw new Error('unreachable');
    expect(close.facts).toEqual(['kept: true']);
    expect(JSON.stringify(rows)).not.toContain('TypeError');
  });

  it('renders a block kind it does not know as a fact line, never crashing', () => {
    seq = 0;
    const rows = toChatRows([
      ev({
        type: 'outcome',
        value: {},
        display: {
          blocks: [
            { kind: 'timeline', points: 3 },
            { kind: 'facts', lines: ['12 docs kept'] },
          ],
        },
      } as never),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['close']);
    const close = rows[0];
    if (close.kind !== 'close') throw new Error('unreachable');
    expect(close.facts).toEqual(['timeline · points: 3', '12 docs kept']);
  });

  it('treats a display without a blocks array as no display at all', () => {
    // Transcript lines reach the client as bare JSON.parse output; a display
    // stamped without blocks must degrade to the generic digest, not crash.
    seq = 0;
    const rows = toChatRows([ev({ type: 'outcome', value: { kept: true }, display: {} } as never)]);
    expect(rows.map((r) => r.kind)).toEqual(['close']);
    const close = rows[0];
    if (close.kind !== 'close') throw new Error('unreachable');
    expect(close.facts).toEqual(['kept: true']);
  });
});
