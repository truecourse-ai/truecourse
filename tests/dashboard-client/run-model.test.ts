/**
 * How a run record reads before anything renders it: the steps it declared,
 * how long it took, how much of it is waiting on a person, and the short forms
 * the header wears.
 *
 * Blocks reach the client as bare wire JSON that nothing on the read path
 * validates, so the checklist reader is held to never taking a malformed one at
 * its word.
 */

import { describe, it, expect } from 'vitest';
import type { ChecklistItem } from '@truecourse/agent-loop';
import {
  commandLabel,
  runChecklist,
  runDuration,
  shortRef,
  waitingCount,
} from '@/components/sessions/run-model';
import type { PublicSessionRun } from '@/lib/api';

const spent = { turns: 0, tokens: 0, costUsd: 0 };

function run(over: Partial<PublicSessionRun> = {}): PublicSessionRun {
  return {
    command: 'spec-scan',
    runId: 'run-scan',
    gitRef: '4d80ec9a1b2c3d4e5f60718293a4b5c6d7e8f900',
    startedAt: '2026-08-25T14:32:00.000Z',
    status: 'running',
    sessions: [],
    ...over,
  } as PublicSessionRun;
}

const checklist = (items: ChecklistItem[]): PublicSessionRun['display'] => ({
  blocks: [{ kind: 'checklist', items }],
});

describe('what a run says about its own steps', () => {
  it('reads several checklist blocks as one list, in order', () => {
    // A run may say its structure in more than one block; every item counts.
    const record = run({
      display: {
        blocks: [
          { kind: 'checklist', items: [{ key: 'a', label: 'First', status: 'done' }] },
          { kind: 'facts', lines: ['41 docs discovered'] },
          {
            kind: 'checklist',
            items: [
              { key: 'b', label: 'Second', status: 'active' },
              { key: 'c', label: 'Third', status: 'pending' },
            ],
          },
        ],
      },
    });
    expect(runChecklist(record).map((s) => s.key)).toEqual(['a', 'b', 'c']);
  });

  it('takes nothing from a checklist block whose items are not a list', () => {
    const record = run({
      display: {
        blocks: [
          { kind: 'checklist', items: { first: 'nope' } },
          { kind: 'checklist', items: [{ key: 'a', label: 'First', status: 'done' }] },
          // A kind minted after this client shipped is not a checklist either.
          { kind: 'budget', spentUsd: 1.4, of: 'the scan ceiling' },
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });
    expect(runChecklist(record).map((s) => s.key)).toEqual(['a']);
  });

  it('has no steps at all when the run declared none', () => {
    expect(runChecklist(run())).toEqual([]);
    expect(runChecklist(run({ display: checklist([]) }))).toEqual([]);
  });
});

describe('the facts a header wears', () => {
  it('takes a settled run from its own timestamps and leaves the undatable blank', () => {
    expect(
      runDuration(run({ status: 'completed', finishedAt: '2026-08-25T14:41:03.000Z' })),
    ).toBe('9m 03s');
    // A live one is measured against now, at render time.
    expect(runDuration(run(), Date.parse('2026-08-25T14:38:12.000Z'))).toBe('6m 12s');
    expect(runDuration(run({ startedAt: 'not-a-date' }))).toBe('');
  });

  it('shortens a commit ref and leaves a branch name alone', () => {
    expect(shortRef(run().gitRef)).toBe('4d80ec9a');
    expect(shortRef('main')).toBe('main');
  });

  it('counts what is waiting on a person', () => {
    expect(
      waitingCount(
        run({
          sessions: [
            { sessionId: 'a', kind: 'spec-scan.curate-doc', workItem: 'doc:a.md', status: 'completed', spent: { ...spent } },
            { sessionId: 'b', kind: 'spec-scan.curate-doc', workItem: 'doc:b.md', status: 'waiting', spent: { ...spent } },
          ],
        }),
      ),
    ).toBe(1);
    expect(waitingCount(run())).toBe(0);
  });

  it('says a command id in words', () => {
    expect(commandLabel('spec-scan')).toBe('spec scan');
    expect(commandLabel('guard-generate')).toBe('guard generate');
  });
});
