import { describe, it, expect } from 'vitest'
import {
  GuardFlowSchema,
  GuardFlowsFileSchema,
  GuardFlowMilestoneSchema,
  GuardManifestSchema,
  GuardDecisionsSchema,
  EMPTY_GUARD_DECISIONS,
  FLOW_IDENTITY_OVERLAP_THRESHOLD,
  flowFingerprint,
  flowMilestoneKey,
  guardManifestSections,
  resolveFlowIdentity,
  type GuardFlow,
  type GuardFlowMilestone,
} from '@truecourse/shared'

const DOC = 'docs/specs/tasks.md'

function milestone(order: number, anchor: string, claimTitle: string): GuardFlowMilestone {
  return { order, doc: DOC, anchor, claimTitle }
}

function flow(id: string, milestones: GuardFlowMilestone[], title = id): GuardFlow {
  return {
    id,
    title,
    goal: `goal of ${id}`,
    fingerprint: flowFingerprint(milestones),
    milestones,
    bindings: [...new Set(milestones.map((m) => m.anchor))].map((anchor) => ({
      doc: DOC,
      anchor,
      fingerprint: `sha256:${anchor}`,
    })),
    composedOf: [],
    synthesisInputsHash: 'sha256:inputs',
  }
}

const CREATE = milestone(1, 'tasks/creating-tasks', 'Creating a task returns it with an id')
const LIST = milestone(2, 'tasks/listing-tasks', 'The list shows tasks newest-first')
const COMPLETE = milestone(3, 'tasks/completing-tasks', 'A task can be marked done')
const FILTER = milestone(4, 'tasks/completing-tasks', 'Done tasks appear under the done filter')

describe('guard flow schemas', () => {
  it('round-trips a flows file through JSON', () => {
    const file = {
      version: 1 as const,
      generatedAt: '2026-07-24T12:00:00.000Z',
      flows: [flow('task-lifecycle', [CREATE, LIST, COMPLETE, FILTER])],
      noFlowClaims: [
        { doc: DOC, anchor: 'tasks/rate-limits', claimTitle: 'writes are rate-limited', reason: 'needs a clock' },
      ],
    }
    expect(GuardFlowsFileSchema.parse(JSON.parse(JSON.stringify(file)))).toEqual(file)
  })

  it('defaults noFlowClaims and composedOf to []', () => {
    const parsed = GuardFlowsFileSchema.parse({
      version: 1,
      generatedAt: 'now',
      flows: [{ ...flow('atomic', [CREATE]), composedOf: undefined }],
    })
    expect(parsed.noFlowClaims).toEqual([])
    expect(parsed.flows[0].composedOf).toEqual([])
  })

  it('requires at least one milestone and one binding', () => {
    expect(() => GuardFlowSchema.parse({ ...flow('empty', [CREATE]), milestones: [] })).toThrow()
    expect(() => GuardFlowSchema.parse({ ...flow('empty', [CREATE]), bindings: [] })).toThrow()
  })

  it('a milestone order is a positive integer', () => {
    expect(() => GuardFlowMilestoneSchema.parse({ ...CREATE, order: 0 })).toThrow()
    expect(() => GuardFlowMilestoneSchema.parse({ ...CREATE, order: 1.5 })).toThrow()
  })
})

describe('flowFingerprint', () => {
  it('is a sha256 over the ordered milestone list', () => {
    expect(flowFingerprint([CREATE, LIST])).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('ignores the array order — `order` is what sequences the path', () => {
    expect(flowFingerprint([LIST, CREATE])).toBe(flowFingerprint([CREATE, LIST]))
  })

  it('moves when the path is re-sequenced', () => {
    const swapped = [
      { ...CREATE, order: 2 },
      { ...LIST, order: 1 },
    ]
    expect(flowFingerprint(swapped)).not.toBe(flowFingerprint([CREATE, LIST]))
  })

  it('normalizes whitespace — a re-wrapped claim never moves it', () => {
    const rewrapped = { ...CREATE, claimTitle: '  Creating a task\n  returns it with an id ' }
    expect(flowFingerprint([rewrapped])).toBe(flowFingerprint([CREATE]))
  })

  it('moves when a claim or an anchor changes', () => {
    expect(flowFingerprint([{ ...CREATE, claimTitle: 'something else' }])).not.toBe(flowFingerprint([CREATE]))
    expect(flowFingerprint([{ ...CREATE, anchor: 'tasks/other' }])).not.toBe(flowFingerprint([CREATE]))
  })

  it('the milestone key is the anchor + the claim text, normalized', () => {
    expect(flowMilestoneKey(CREATE)).toBe(`${CREATE.anchor}\0${CREATE.claimTitle}`)
    expect(flowMilestoneKey({ anchor: ' a  b ', claimTitle: 'x\ny' })).toBe('a b\0x y')
  })

  it('a note never moves the fingerprint', () => {
    expect(flowFingerprint([{ ...CREATE, note: 'synthesis rationale' }])).toBe(flowFingerprint([CREATE]))
  })
})

describe('resolveFlowIdentity', () => {
  it('remaps an identical milestone multiset, keeping the prior id', () => {
    const prev = [flow('task-lifecycle', [CREATE, LIST, COMPLETE])]
    const next = [flow('a-user-manages-tasks', [CREATE, LIST, COMPLETE], 'A user manages tasks')]
    const { verdicts, orphaned } = resolveFlowIdentity(prev, next)
    expect(verdicts).toEqual([{ kind: 'remap', id: 'task-lifecycle' }])
    expect(orphaned).toEqual([])
  })

  it('remaps regardless of the milestones array order', () => {
    const prev = [flow('task-lifecycle', [CREATE, LIST, COMPLETE])]
    const next = [flow('reworded', [COMPLETE, CREATE, LIST])]
    expect(resolveFlowIdentity(prev, next).verdicts[0]).toEqual({ kind: 'remap', id: 'task-lifecycle' })
  })

  it('goes stale in place on a majority overlap with a unique best candidate', () => {
    const prev = [flow('task-lifecycle', [CREATE, LIST, COMPLETE, FILTER])]
    const next = [flow('provisional', [CREATE, LIST, COMPLETE])]
    const { verdicts, orphaned } = resolveFlowIdentity(prev, next)
    expect(verdicts).toEqual([{ kind: 'stale', id: 'task-lifecycle' }])
    expect(orphaned).toEqual([])
  })

  it('a minority overlap is a new flow, and the prior flow orphans', () => {
    const prev = [flow('task-lifecycle', [CREATE, LIST, COMPLETE, FILTER])]
    const next = [flow('provisional', [CREATE])]
    const { verdicts, orphaned } = resolveFlowIdentity(prev, next)
    expect(verdicts).toEqual([{ kind: 'new', id: 'provisional' }])
    expect(orphaned.map((f) => f.id)).toEqual(['task-lifecycle'])
  })

  it('an ambiguous tie is NEW, never a coin flip', () => {
    const prev = [flow('left', [CREATE, LIST]), flow('right', [CREATE, COMPLETE])]
    const next = [flow('provisional', [CREATE, LIST, COMPLETE])]
    // 2 of 3 milestones shared with each prior flow — same score, no unique best.
    expect(resolveFlowIdentity(prev, next).verdicts).toEqual([{ kind: 'new', id: 'provisional' }])
  })

  it('claims each prior flow at most once — exact matches win over partial ones', () => {
    const prev = [flow('task-lifecycle', [CREATE, LIST, COMPLETE])]
    const next = [
      flow('partial', [CREATE, LIST]),
      flow('exact', [CREATE, LIST, COMPLETE]),
    ]
    const { verdicts, orphaned } = resolveFlowIdentity(prev, next)
    expect(verdicts).toEqual([
      { kind: 'new', id: 'partial' },
      { kind: 'remap', id: 'task-lifecycle' },
    ])
    expect(orphaned).toEqual([])
  })

  it('never resolves by title', () => {
    const prev = [flow('task-lifecycle', [CREATE, LIST], 'Task lifecycle')]
    const next = [flow('task-lifecycle', [milestone(1, 'billing/plans', 'Plans are listed')], 'Task lifecycle')]
    const { verdicts, orphaned } = resolveFlowIdentity(prev, next)
    expect(verdicts).toEqual([{ kind: 'new', id: 'task-lifecycle' }])
    expect(orphaned.map((f) => f.id)).toEqual(['task-lifecycle'])
  })

  it('the overlap threshold is measured against the LARGER milestone set', () => {
    expect(FLOW_IDENTITY_OVERLAP_THRESHOLD).toBe(0.5)
    // 1 shared of 2 (prev) = 50%, which is NOT above the threshold.
    const prev = [flow('two', [CREATE, LIST])]
    const next = [flow('one', [CREATE])]
    expect(resolveFlowIdentity(prev, next).verdicts).toEqual([{ kind: 'new', id: 'one' }])
  })

  it('an empty prior corpus makes everything new', () => {
    const { verdicts, orphaned } = resolveFlowIdentity([], [flow('a', [CREATE]), flow('b', [LIST])])
    expect(verdicts).toEqual([
      { kind: 'new', id: 'a' },
      { kind: 'new', id: 'b' },
    ])
    expect(orphaned).toEqual([])
  })
})

describe('guard manifest v2 (flow-keyed)', () => {
  const manifest = {
    version: 2 as const,
    flows: [
      {
        flowId: 'task-lifecycle',
        flowFingerprint: flowFingerprint([CREATE, LIST]),
        bindings: [
          { doc: DOC, anchor: 'tasks/creating-tasks', fingerprint: 'sha256:c' },
          { doc: DOC, anchor: 'tasks/listing-tasks', fingerprint: 'sha256:l' },
        ],
        scenarios: [
          { id: 'task-lifecycle.cli.1', surface: 'cli' as const, status: 'passing' as const },
          { id: 'task-lifecycle.api.1', surface: 'api' as const, status: 'passing' as const },
        ],
        journeys: [
          { surface: 'cli' as const, journeyIds: ['cli/tasks-add', 'cli/tasks-list'] },
          { surface: 'web' as const, journeyIds: ['web/board'] },
        ],
        generationInputsHash: 'sha256:gen',
        gaps: [
          { surface: 'web' as const, kind: 'awaiting-driver' as const, reason: 'no web driver', driver: 'web' as const },
        ],
      },
    ],
  }

  it('round-trips through JSON — including the per-surface planned journeys', () => {
    const parsed = GuardManifestSchema.parse(JSON.parse(JSON.stringify(manifest)))
    expect(parsed).toEqual(manifest)
    // The web plan survives even though NO web scenario exists — that record is the
    // only trace a matched-but-unauthored surface leaves.
    expect(parsed.flows[0].journeys.find((j) => j.surface === 'web')?.journeyIds).toEqual(['web/board'])
  })

  it('defaults the generation-inputs hash to null, and gaps/journeys to []', () => {
    const parsed = GuardManifestSchema.parse({
      version: 2,
      flows: [{ flowId: 'f', flowFingerprint: 'sha256:x', bindings: [], scenarios: [] }],
    })
    expect(parsed.flows[0].generationInputsHash).toBeNull()
    expect(parsed.flows[0].gaps).toEqual([])
    // A manifest written before the field still parses — the journeys read then
    // falls back to the committed scenarios' own refs.
    expect(parsed.flows[0].journeys).toEqual([])
  })

  it('rejects a v1 manifest (clean cut)', () => {
    expect(() =>
      GuardManifestSchema.parse({
        guard: 1,
        sections: [{ doc: DOC, anchor: 'a', fingerprint: 'sha256:1', scenarioIds: [] }],
      }),
    ).toThrow()
  })

  it('an awaiting-driver gap carries its driver; other kinds carry none', () => {
    const base = { version: 2, flows: [{ ...manifest.flows[0] }] }
    const withBadGap = {
      ...base,
      flows: [{ ...manifest.flows[0], gaps: [{ surface: 'cli', kind: 'awaiting-driver', reason: 'r' }] }],
    }
    expect(() => GuardManifestSchema.parse(withBadGap)).toThrow()
    const untestable = {
      ...base,
      flows: [{ ...manifest.flows[0], gaps: [{ surface: 'cli', kind: 'untestable', reason: 'r' }] }],
    }
    expect(() => GuardManifestSchema.parse(untestable)).not.toThrow()
  })

  it('projects onto sections at read time — one row per bound section', () => {
    const sections = guardManifestSections(manifest)
    expect(sections.map((s) => s.anchor)).toEqual(['tasks/creating-tasks', 'tasks/listing-tasks'])
    expect(sections[0]).toEqual({
      doc: DOC,
      anchor: 'tasks/creating-tasks',
      fingerprint: 'sha256:c',
      flowIds: ['task-lifecycle'],
      scenarioIds: ['task-lifecycle.api.1', 'task-lifecycle.cli.1'],
      generationInputsHash: 'sha256:gen',
    })
  })

  it('unions the flows binding one section, and nulls a disagreeing inputs hash', () => {
    const twoFlows = {
      version: 2 as const,
      flows: [
        { ...manifest.flows[0], flowId: 'one', generationInputsHash: 'sha256:a' },
        { ...manifest.flows[0], flowId: 'two', generationInputsHash: 'sha256:b', scenarios: [{ id: 'two.cli.1', surface: 'cli' as const }] },
      ],
    }
    const [first] = guardManifestSections(twoFlows)
    expect(first.flowIds).toEqual(['one', 'two'])
    expect(first.scenarioIds).toEqual(['task-lifecycle.api.1', 'task-lifecycle.cli.1', 'two.cli.1'])
    expect(first.generationInputsHash).toBeNull()
  })

  it('a null manifest projects to no sections', () => {
    expect(guardManifestSections(null)).toEqual([])
  })
})

describe('guard decisions — dismissedFlows', () => {
  it('round-trips dismissed flows and defaults them to []', () => {
    const file = {
      version: 1 as const,
      dismissedClaims: [],
      dismissedFlows: [
        { flowId: 'task-lifecycle', title: 'Task lifecycle', dismissedAt: '2026-07-24T12:00:00.000Z', note: 'not a user path' },
      ],
    }
    expect(GuardDecisionsSchema.parse(file)).toEqual(file)
    expect(GuardDecisionsSchema.parse({ version: 1 })).toEqual(EMPTY_GUARD_DECISIONS)
  })

  it('a dismissed flow needs a flowId, a title, and a timestamp', () => {
    expect(() =>
      GuardDecisionsSchema.parse({ version: 1, dismissedFlows: [{ flowId: 'f', dismissedAt: 'now' }] }),
    ).toThrow()
  })
})
