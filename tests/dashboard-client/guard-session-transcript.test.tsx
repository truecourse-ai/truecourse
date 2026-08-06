/**
 * The worker-session transcript pane:
 *
 *   - a surface row gains a "Session" expander ONLY when the report carried an
 *     `authoringRunId` — no run id, no expander (older reports predate it);
 *   - opening it backfills the transcript and renders one block per event
 *     (init → reply → tool → reask → outcome → end), a REPLAYED transcript
 *     rendering exactly like a live one;
 *   - long assistant replies clamp past ~12 lines behind "Show more";
 *   - live `guard:transcript` batches append by transcript index — matching
 *     (runId, flowId, surface) only, duplicates idempotent.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GuardFlowDetail as GuardFlowDetailData } from '@truecourse/shared';
import { GuardFlowDetail } from '@/components/guard/GuardFlowDetail';
import { GuardSessionTranscript } from '@/components/guard/GuardSessionTranscript';
import { mergeTranscriptBatch, sanitizeTranscriptSegment } from '@/lib/guard-session';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const REPO_ID = 'taskbird';
const RUN_ID = '2026-08-05T10-00-00Z_ab12cd34';
const FLOW_ID = 'task-lifecycle';

const INIT = {
  kind: 'init',
  ts: '2026-08-05T10:00:00.000Z',
  system: 'You author guard scenarios.',
  user: 'Author a scenario for task-lifecycle.',
  tools: ['run_scenario', 'read_journey'],
  model: 'claude-sonnet-4-5',
};
const REPLY = {
  kind: 'reply',
  ts: '2026-08-05T10:00:01.000Z',
  turn: 1,
  text: 'Trying the lifecycle with a wrong flag first.',
  toolCall: { name: 'run_scenario', arguments: { steps: 3 } },
};
const TOOL = {
  kind: 'tool',
  ts: '2026-08-05T10:00:02.000Z',
  turn: 1,
  name: 'run_scenario',
  args: { steps: 3 },
  result: 'exit 2: unknown flag --done',
  durationMs: 812,
};
const REASK = {
  kind: 'reask',
  ts: '2026-08-05T10:00:03.000Z',
  turn: 2,
  detail: 'no parsable JSON action block found in the reply',
};
const OUTCOME = {
  kind: 'outcome',
  ts: '2026-08-05T10:00:04.000Z',
  turn: 3,
  outcome: { result: 'settled', scenarioId: 'task-lifecycle.cli.1' },
};
const END = {
  kind: 'end',
  ts: '2026-08-05T10:00:05.000Z',
  status: 'outcome',
  turns: 3,
  usage: { turns: 3, inputTokens: 1200, outputTokens: 340, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0.04 },
};
const TRANSCRIPT = [INIT, REPLY, TOOL, REASK, OUTCOME, END];

const DETAIL: GuardFlowDetailData = {
  flowId: FLOW_ID,
  title: 'A user creates a task and completes it',
  goal: 'Create and complete a task from the CLI',
  status: 'pass',
  bucket: 'guarded',
  epic: false,
  manual: false,
  composedOf: [],
  milestones: [],
  surfaces: [
    {
      surface: 'cli',
      scenarioId: 'task-lifecycle.cli.1',
      title: 'Tasks are created and completed',
      status: 'pass',
      birthPassed: true,
      hasEvidence: false,
      journeyPath: [],
    },
    {
      surface: 'web',
      status: 'web',
      birthPassed: false,
      hasEvidence: false,
      journeyPath: [],
      gap: { kind: 'awaiting-driver', driver: 'web', reason: 'browser-only', label: 'awaiting web driver' },
    },
  ],
  gaps: [],
  journeyIds: [],
  findings: [],
  errors: [],
  generatedAt: '2026-08-05T09:00:00.000Z',
  runId: null,
  ranAt: null,
};

let transcriptCalls: string[];

function stubFetch(events: unknown[] = TRANSCRIPT) {
  transcriptCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('/guard/transcript?')) {
        transcriptCalls.push(u);
        return json({ events });
      }
      return json({});
    }),
  );
}

beforeEach(() => stubFetch());
afterEach(() => vi.unstubAllGlobals());

const renderDetail = (props: Partial<Parameters<typeof GuardFlowDetail>[0]> = {}) =>
  render(
    <GuardFlowDetail
      detail={DETAIL}
      repoId={REPO_ID}
      authoringRunId={RUN_ID}
      onOpenSpec={() => {}}
      onOpenTest={() => {}}
      onOpenJourney={() => {}}
      {...props}
    />,
  );

describe('the Session expander on a surface row', () => {
  it('is hidden entirely when the report carries no authoringRunId', () => {
    renderDetail({ authoringRunId: undefined });
    expect(screen.queryByText('Session')).not.toBeInTheDocument();
  });

  it('renders one expander per surface row when the run id is known', () => {
    renderDetail();
    expect(screen.getAllByText('Session')).toHaveLength(DETAIL.surfaces.length);
  });

  it('opens into the backfilled transcript for (flow, surface)', async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getAllByText('Session')[0]);

    expect(transcriptCalls).toHaveLength(1);
    expect(transcriptCalls[0]).toContain(`runId=${encodeURIComponent(RUN_ID)}`);
    expect(transcriptCalls[0]).toContain(`flowId=${encodeURIComponent(FLOW_ID)}`);
    expect(transcriptCalls[0]).toContain('surface=cli');

    const log = await screen.findByRole('log', { name: 'Worker session transcript' });
    // init: the session opened, model + tool names.
    expect(within(log).getByText(/Session opened/)).toBeInTheDocument();
    expect(within(log).getByText(/claude-sonnet-4-5/)).toBeInTheDocument();
    expect(within(log).getByText(/run_scenario, read_journey/)).toBeInTheDocument();
    // reply: the assistant text plus the tool it called.
    expect(within(log).getByText(REPLY.text)).toBeInTheDocument();
    expect(within(log).getByText(/assistant · turn 1 · calls run_scenario/)).toBeInTheDocument();
    // tool: name + duration.
    expect(within(log).getByText(/812 ms/)).toBeInTheDocument();
    // reask: the amber nudge with its detail.
    expect(within(log).getByText(/Re-asked · no parsable JSON action block/)).toBeInTheDocument();
    // outcome: the outcome JSON.
    expect(within(log).getByText(/Outcome · turn 3/)).toBeInTheDocument();
    expect(within(log).getByText(/task-lifecycle\.cli\.1/)).toBeInTheDocument();
    // end: status + turns + token totals.
    expect(within(log).getByText(/Session ended · outcome · 3 turns · 1,200 in \/ 340 out tokens/)).toBeInTheDocument();
  });

  it('opens the tool result behind its collapsible pre', async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getAllByText('Session')[0]);
    const log = await screen.findByRole('log', { name: 'Worker session transcript' });

    expect(within(log).queryByText(TOOL.result)).not.toBeInTheDocument();
    await user.click(within(log).getByRole('button', { name: 'result' }));
    expect(within(log).getByText(TOOL.result)).toBeInTheDocument();
  });

  it('shows "No session yet" when the worker has written nothing', async () => {
    stubFetch([]);
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getAllByText('Session')[0]);
    expect(await screen.findByText('No session yet')).toBeInTheDocument();
  });
});

describe('GuardSessionTranscript', () => {
  it('clamps a long reply past 12 lines behind "Show more"', async () => {
    const longReply = {
      ...REPLY,
      text: Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n'),
    };
    stubFetch([INIT, longReply]);
    render(<GuardSessionTranscript repoId={REPO_ID} runId={RUN_ID} flowId={FLOW_ID} surface="cli" />);

    const more = await screen.findByRole('button', { name: 'Show more (8 more lines)' });
    expect(screen.queryByText(/line 20/)).not.toBeInTheDocument();
    await userEvent.setup().click(more);
    expect(screen.getByText(/line 20/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
  });

  it('appends matching live batches by transcript index and ignores the rest', async () => {
    stubFetch([INIT]);
    const handlers = new Map<string, (data: unknown) => void>();
    const onEvent = (event: string, handler: (data: unknown) => void) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    };
    render(
      <GuardSessionTranscript repoId={REPO_ID} runId={RUN_ID} flowId={FLOW_ID} surface="cli" onEvent={onEvent} />,
    );
    await screen.findByText(/Session opened/);

    const push = (batch: unknown) => act(() => handlers.get('guard:transcript')?.(batch));
    // Another flow's batch must not bleed in.
    push({ runId: RUN_ID, flowId: 'other-flow', surface: 'cli', seq: 1, events: [REPLY] });
    expect(screen.queryByText(REPLY.text)).not.toBeInTheDocument();

    push({ runId: RUN_ID, flowId: FLOW_ID, surface: 'cli', seq: 1, events: [REPLY] });
    expect(screen.getByText(REPLY.text)).toBeInTheDocument();

    // A replayed duplicate of the same lines lands on the same slots — no doubling.
    push({ runId: RUN_ID, flowId: FLOW_ID, surface: 'cli', seq: 0, events: [INIT, REPLY] });
    expect(screen.getAllByText(REPLY.text)).toHaveLength(1);

    push({ runId: RUN_ID, flowId: FLOW_ID, surface: 'cli', seq: 2, events: [END] });
    expect(screen.getByText(/Session ended · outcome/)).toBeInTheDocument();
  });
});

describe('guard-session merge helpers', () => {
  it('sanitizes segments exactly like the transcript writer', () => {
    expect(sanitizeTranscriptSegment('docs/spec.md#alpha')).toBe('docs_spec.md_alpha');
    expect(sanitizeTranscriptSegment('task-lifecycle')).toBe('task-lifecycle');
  });

  it('merges batches sparsely and idempotently', () => {
    const a = mergeTranscriptBatch([], 2, ['c']);
    expect(a).toEqual([undefined, undefined, 'c']);
    const b = mergeTranscriptBatch(a, 0, ['a', 'b']);
    expect(b).toEqual(['a', 'b', 'c']);
    expect(mergeTranscriptBatch(b, 1, ['b'])).toEqual(['a', 'b', 'c']);
  });
});
