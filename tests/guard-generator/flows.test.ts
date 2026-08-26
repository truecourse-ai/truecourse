import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildDocSectionIndex } from '@truecourse/guard-runner'
import {
  synthesizeFlows,
  buildFlowAreas,
  checkFlowSet,
  flowSectionKey,
  isFlowSetClean,
  isFlowSynthesisWipeout,
  flowsPath,
  readFlowsFile,
  type EpicSynthesis,
  type FlowSet,
  type FlowSynthesisArea,
  type FlowsAreaSessionResult,
  type FlowsAreaSessionSeam,
  type FlowsEpicSessionSeam,
  type FlowClaimInput,
  type FlowSynthesisResult,
} from '@truecourse/guard-generator'
import { GuardFlowsFileSchema, type GuardFlow } from '@truecourse/shared'
import { makeTempRepo, rmrf, sessionSummary, FLOWS_KIND } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

// --- A realistic two-area spec corpus ---------------------------------------

const TASKS_DOC = 'docs/tasks.md'
const TASKS_CONTENT = [
  '# Tasks',
  '',
  '## Creating tasks',
  '',
  '`relkit add <title>` creates a task and prints its id as `t<N>`.',
  'An empty title exits 2 and writes `title is required` to stderr.',
  '',
  '## Listing tasks',
  '',
  '`relkit list` prints one line per open task, newest first.',
  '',
  '## Completing tasks',
  '',
  '`relkit done <id>` marks the task complete and prints `Completed t<N> ✓`.',
  '`relkit list --done` prints only the completed tasks.',
].join('\n')

const AUTH_DOC = 'docs/auth.md'
const AUTH_CONTENT = [
  '# Accounts',
  '',
  '## Signing in',
  '',
  '`POST /session` with valid credentials answers 200 and sets a session cookie.',
  '',
  '## Signing out',
  '',
  '`DELETE /session` answers 204 and clears the session cookie.',
].join('\n')

interface DocFixture {
  doc: string
  outline: { anchor: string; headingText: string; level: number }[]
  anchors: Record<string, string>
  fingerprints: Map<string, string>
}

/** Index a document exactly the way the runner does — real anchors, real
 *  fingerprints, so bindings in these tests are the ones a run would write. */
function indexDoc(doc: string, content: string): DocFixture {
  const index = buildDocSectionIndex(doc, content)
  const anchors: Record<string, string> = {}
  const fingerprints = new Map<string, string>()
  for (const s of index.sections) {
    anchors[s.headingText] = s.anchor
    fingerprints.set(flowSectionKey(doc, s.anchor), s.fingerprint)
  }
  return {
    doc,
    outline: index.sections.map((s) => ({ anchor: s.anchor, headingText: s.headingText, level: s.level })),
    anchors,
    fingerprints,
  }
}

const TASKS = indexDoc(TASKS_DOC, TASKS_CONTENT)
const AUTH = indexDoc(AUTH_DOC, AUTH_CONTENT)

const ADD = '`relkit add <title>` creates a task and prints its id as `t<N>`'
const ADD_EMPTY = '`relkit add` with an empty title exits 2 and writes `title is required` to stderr'
const LIST = '`relkit list` prints one line per open task, newest first'
const DONE = '`relkit done <id>` prints `Completed t<N> ✓`'
const LIST_DONE = '`relkit list --done` prints only the completed tasks'
const SIGN_IN = '`POST /session` with valid credentials answers 200 and sets a session cookie'
const SIGN_OUT = '`DELETE /session` answers 204 and clears the session cookie'

function claim(fixture: DocFixture, heading: string, title: string, driver: FlowClaimInput['driver'] = 'cli'): FlowClaimInput {
  return { doc: fixture.doc, anchor: fixture.anchors[heading], title, driver }
}

const TASK_CLAIMS: FlowClaimInput[] = [
  claim(TASKS, 'Creating tasks', ADD),
  claim(TASKS, 'Creating tasks', ADD_EMPTY),
  claim(TASKS, 'Listing tasks', LIST),
  claim(TASKS, 'Completing tasks', DONE),
  claim(TASKS, 'Completing tasks', LIST_DONE),
]

const AUTH_CLAIMS: FlowClaimInput[] = [
  claim(AUTH, 'Signing in', SIGN_IN, 'api'),
  claim(AUTH, 'Signing out', SIGN_OUT, 'api'),
]

const tasksArea: FlowSynthesisArea = {
  areaId: 'tasks',
  claims: TASK_CLAIMS,
  docs: [{ doc: TASKS.doc, outline: TASKS.outline }],
}
const authArea: FlowSynthesisArea = {
  areaId: 'accounts',
  claims: AUTH_CLAIMS,
  docs: [{ doc: AUTH.doc, outline: AUTH.outline }],
}

const FINGERPRINTS = new Map([...TASKS.fingerprints, ...AUTH.fingerprints])

/** A milestone reference as the model returns it. */
function ms(fixture: DocFixture, heading: string, claimTitle: string, order?: number) {
  return { doc: fixture.doc, anchor: fixture.anchors[heading], claimTitle, ...(order ? { order } : {}) }
}

/**
 * The per-area SESSION seam, answering from a per-area map — a `FlowSet` is a
 * completed session, an `{ ok: false }` is a failed one. Every area it was
 * handed is recorded, so a test can assert which areas the pool worked on
 * (the cache lives in the seam now, so an area the run skips never appears).
 */
function areaSessions(
  answers: Record<string, FlowSet | FlowsAreaSessionResult>,
  seen: FlowSynthesisArea[] = [],
): FlowsAreaSessionSeam & { seen: FlowSynthesisArea[] } {
  const seam = (async ({ areas, onArea }: Parameters<FlowsAreaSessionSeam>[0]) => {
    const byArea = new Map<string, FlowsAreaSessionResult>()
    for (const area of areas) {
      seen.push(area)
      const answer = answers[area.areaId] ?? { flows: [], noFlowClaims: [] }
      byArea.set(
        area.areaId,
        'flows' in answer ? { ok: true, value: answer, inputsKey: `key:${area.areaId}` } : answer,
      )
      onArea?.(area.areaId)
    }
    return { byArea, summary: sessionSummary(FLOWS_KIND, { ran: areas.length }) }
  }) as FlowsAreaSessionSeam & { seen: FlowSynthesisArea[] }
  seam.seen = seen
  return seam
}

/** The epic SESSION seam over one fixed answer, recording the digests it saw. */
function epicSession(
  answer: EpicSynthesis | { ok: false; reason: string },
  seen: Parameters<FlowsEpicSessionSeam>[0][] = [],
): FlowsEpicSessionSeam & { seen: Parameters<FlowsEpicSessionSeam>[0][] } {
  const seam = (async (input: Parameters<FlowsEpicSessionSeam>[0]) => {
    seen.push(input)
    return {
      result: 'epics' in answer ? ({ ok: true as const, value: answer, inputsKey: 'key:epic' }) : answer,
      summary: sessionSummary(FLOWS_KIND, { ran: 1 }),
    }
  }) as FlowsEpicSessionSeam & { seen: Parameters<FlowsEpicSessionSeam>[0][] }
  seam.seen = seen
  return seam
}

/** The default epic seam: nothing chains, and nothing is recorded. */
const noEpics: FlowsEpicSessionSeam = async () => ({
  result: { ok: true, value: { epics: [] }, inputsKey: 'key:epic' },
  summary: sessionSummary(FLOWS_KIND, { ran: 1 }),
})

/** The whole-corpus answer: the task lifecycle plus the empty-title edge case. */
const TASK_LIFECYCLE = {
  flows: [
    {
      title: 'Create, list and complete a task',
      goal: 'A user adds a task, sees it listed, completes it, and finds it under the completed filter.',
      milestones: [
        ms(TASKS, 'Creating tasks', ADD, 1),
        ms(TASKS, 'Listing tasks', LIST, 2),
        ms(TASKS, 'Completing tasks', DONE, 3),
        ms(TASKS, 'Completing tasks', LIST_DONE, 4),
      ],
    },
    {
      title: 'Adding a task without a title is rejected',
      goal: 'A user who omits the title gets a clear error instead of an empty task.',
      milestones: [ms(TASKS, 'Creating tasks', ADD_EMPTY, 1)],
    },
  ],
  noFlowClaims: [],
}

const AUTH_SESSION = {
  flows: [
    {
      title: 'Sign in and sign out',
      goal: 'A user opens a session and closes it again.',
      milestones: [ms(AUTH, 'Signing in', SIGN_IN, 1), ms(AUTH, 'Signing out', SIGN_OUT, 2)],
    },
  ],
  noFlowClaims: [],
}

async function synth(
  r: string,
  areas: FlowSynthesisArea[],
  areaSession: FlowsAreaSessionSeam,
  extra: Partial<Parameters<typeof synthesizeFlows>[0]> = {},
) {
  return synthesizeFlows({
    repoRoot: r,
    areas,
    areaSession,
    epicSession: noEpics,
    sectionFingerprints: FINGERPRINTS,
    now: () => new Date('2026-07-24T00:00:00.000Z'),
    ...extra,
  })
}

describe('synthesizeFlows — composition', () => {
  it('composes a composite and an atomic flow, binds their sections, and writes flows.json', async () => {
    const r = repo()
    const runner = areaSessions({ tasks: TASK_LIFECYCLE })
    const res = await synth(r, [tasksArea], runner)

    expect(res.unsettled).toEqual([])
    expect(res.calls).toBe(1)
    expect(res.flows.map((f) => f.id)).toEqual([
      'create-list-and-complete-a-task',
      'adding-a-task-without-a-title-is-rejected',
    ])

    const lifecycle = res.flows[0]
    expect(lifecycle.milestones.map((m) => m.order)).toEqual([1, 2, 3, 4])
    expect(lifecycle.milestones.map((m) => m.claimTitle)).toEqual([ADD, LIST, DONE, LIST_DONE])
    // One binding per distinct section, carrying the LIVE section fingerprint.
    expect(lifecycle.bindings.map((b) => b.anchor)).toEqual([
      TASKS.anchors['Creating tasks'],
      TASKS.anchors['Listing tasks'],
      TASKS.anchors['Completing tasks'],
    ])
    for (const b of lifecycle.bindings) {
      expect(b.fingerprint).toBe(TASKS.fingerprints.get(flowSectionKey(TASKS.doc, b.anchor)))
    }
    expect(lifecycle.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(lifecycle.composedOf).toEqual([])

    // Written, valid, and readable back.
    expect(res.path).toBe(flowsPath(r))
    const onDisk = GuardFlowsFileSchema.parse(JSON.parse(fs.readFileSync(flowsPath(r), 'utf-8')))
    expect(onDisk.version).toBe(1)
    expect(onDisk.flows).toHaveLength(2)
    expect(readFlowsFile(r)?.flows[0].id).toBe('create-list-and-complete-a-task')
  })

  // The AREA the seam is handed is the whole spec-side input: claims + doc
  // outlines, nothing else. (What the session's briefing renders out of it —
  // including the interface GROUNDING step 16 added beside it — is pinned in
  // `tests/core/guard-generate-flows-session.test.ts`.)
  it('hands the seam the area claims and outlines, and nothing else', async () => {
    const r = repo()
    const runner = areaSessions({ tasks: TASK_LIFECYCLE })
    await synth(r, [tasksArea], runner)

    const area = runner.seen[0]
    expect(area.areaId).toBe('tasks')
    expect(Object.keys(area).sort()).toEqual(['areaId', 'claims', 'docs'])
    expect(area.claims.map((c) => c.title)).toEqual([ADD, ADD_EMPTY, LIST, DONE, LIST_DONE])
    expect(area.docs.map((d) => d.doc)).toEqual([TASKS_DOC])
  })

  it('never requires a claim on a non-runnable surface to be accounted for', async () => {
    const r = repo()
    const area: FlowSynthesisArea = {
      ...tasksArea,
      claims: [...TASK_CLAIMS, claim(TASKS, 'Listing tasks', 'the board shows one card per open task', 'tui')],
    }
    const runner = areaSessions({ tasks: TASK_LIFECYCLE })
    const res = await synth(r, [area], runner)

    // The tui claim reaches the session, but leaving it out of every flow is
    // not a refusal — the area settles. (`tui`, not `web`: web's row flips to
    // runnable once generate can author it — item 132.)
    expect(res.calls).toBe(1)
    expect(res.unsettled).toEqual([])
    expect(runner.seen[0].claims.some((c) => c.driver === 'tui')).toBe(true)
  })

  it('records a claim whose section is not in the live index as a no-flow claim', async () => {
    const r = repo()
    const area: FlowSynthesisArea = {
      ...tasksArea,
      claims: [...TASK_CLAIMS, { doc: TASKS_DOC, anchor: 'tasks/deleted-section', title: 'stale claim', driver: 'cli' }],
    }
    const res = await synth(r, [area], areaSessions({ tasks: TASK_LIFECYCLE }))
    expect(res.noFlowClaims.map((c) => c.claimTitle)).toContain('stale claim')
    expect(res.flows.flatMap((f) => f.milestones).some((m) => m.claimTitle === 'stale claim')).toBe(false)
  })
})

describe('synthesizeFlows — milestone snapping and validation', () => {
  it('snaps a paraphrased milestone onto its claim without a re-ask', async () => {
    const r = repo()
    const runner = areaSessions({
      tasks: {
        flows: [
          {
            title: 'Create and list a task',
            goal: 'A user adds a task and sees it.',
            milestones: [
              // Whitespace + case + a trailing period the model added.
              { doc: TASKS_DOC, anchor: TASKS.anchors['Creating tasks'], claimTitle: `  ${ADD.toUpperCase()}.  ` },
              // Truncated by the model — a unique containment match in its section.
              { doc: TASKS_DOC, anchor: TASKS.anchors['Listing tasks'], claimTitle: '`relkit list` prints one line per open task' },
            ],
          },
        ],
        noFlowClaims: [
          { doc: TASKS_DOC, anchor: TASKS.anchors['Creating tasks'], claimTitle: ADD_EMPTY, reason: 'an error path no user flow walks' },
          { doc: TASKS_DOC, anchor: TASKS.anchors['Completing tasks'], claimTitle: DONE, reason: 'covered by the completion flow later' },
          { doc: TASKS_DOC, anchor: TASKS.anchors['Completing tasks'], claimTitle: LIST_DONE, reason: 'a filter, not a flow step' },
        ],
      },
    })
    const res = await synth(r, [tasksArea], runner)

    expect(res.calls).toBe(1)
    expect(res.unsettled).toEqual([])
    // Snapped back to the inventory's canonical text, not the model's paraphrase.
    expect(res.flows[0].milestones.map((m) => m.claimTitle)).toEqual([ADD, LIST])
  })

  // The corrective RE-ASK is retired (plan 04 step 20): the session's own
  // `check_flows` tool is where a milestone gets corrected, in-turn, and the
  // fold NEVER trusts the transcript — a value that still fails validation
  // refuses the area outright instead of buying a second round.
  it('REFUSES the area for a milestone that matches no claim, quoting the reference', async () => {
    const r = repo()
    const runner = areaSessions({
      tasks: {
        flows: [
          {
            title: 'Invented flow',
            goal: 'Asserts something extraction never produced.',
            milestones: [
              { doc: TASKS_DOC, anchor: TASKS.anchors['Creating tasks'], claimTitle: '`relkit archive` hides a task from every list' },
            ],
          },
        ],
        noFlowClaims: [],
      },
    })
    const res = await synth(r, [tasksArea], runner)

    expect(res.calls).toBe(1)
    expect(runner.seen).toHaveLength(1)
    expect(res.flows).toEqual([])
    expect(res.unsettled).toHaveLength(1)
    expect(res.unsettled[0].reason).toContain('flow synthesis refused')
    expect(res.unsettled[0].reason).toContain('relkit archive')
  })

  it('reports a failed session as the area unsettled, with the seam’s reason', async () => {
    const r = repo()
    const res = await synth(r, [tasksArea], areaSessions({ tasks: { ok: false, reason: 'flows session failed: the provider failed' } }))
    expect(res.flows).toEqual([])
    expect(res.unsettled).toEqual([{ areaId: 'tasks', reason: 'flows session failed: the provider failed' }])
  })

  it('reports an area the seam answered for at all as unsettled', async () => {
    const r = repo()
    const seam: FlowsAreaSessionSeam = async () => ({
      byArea: new Map(),
      summary: sessionSummary(FLOWS_KIND, { ran: 1 }),
    })
    const res = await synth(r, [tasksArea], seam)
    expect(res.unsettled).toEqual([{ areaId: 'tasks', reason: 'the flows session produced no result for this area' }])
  })
})

describe('synthesizeFlows — coverage honesty rule', () => {
  it('REFUSES the area when a required claim is in no flow and no noFlowClaims entry', async () => {
    const r = repo()
    const partial = {
      flows: [
        {
          title: 'Create and list a task',
          goal: 'A user adds a task and sees it.',
          milestones: [ms(TASKS, 'Creating tasks', ADD, 1), ms(TASKS, 'Listing tasks', LIST, 2)],
        },
      ],
      noFlowClaims: [],
    }
    const res = await synth(r, [tasksArea], areaSessions({ tasks: partial }))

    expect(res.calls).toBe(1)
    expect(res.flows).toEqual([])
    expect(res.unsettled[0].reason).toContain('3 claim(s) left unaccounted')
    expect(res.unsettled[0].reason).toContain(ADD_EMPTY)
  })

  it('a stated no-flow reason satisfies the rule, and lands in flows.json', async () => {
    const r = repo()
    const res = await synth(
      r,
      [tasksArea],
      areaSessions({
        tasks: {
          flows: [TASK_LIFECYCLE.flows[0]],
          noFlowClaims: [
            {
              doc: TASKS_DOC,
              anchor: TASKS.anchors['Creating tasks'],
              claimTitle: ADD_EMPTY,
              reason: 'a validation error no user flow walks through',
            },
          ],
        },
      }),
    )

    expect(res.calls).toBe(1)
    expect(res.unsettled).toEqual([])
    expect(res.noFlowClaims).toEqual([
      {
        doc: TASKS_DOC,
        anchor: TASKS.anchors['Creating tasks'],
        claimTitle: ADD_EMPTY,
        reason: 'a validation error no user flow walks through',
      },
    ])
    expect(readFlowsFile(r)!.noFlowClaims).toHaveLength(1)
  })

  it('an area that refuses leaves the corpus re-synthesizable next run', async () => {
    const r = repo()
    const stubborn = {
      flows: [{ title: 'Create a task', goal: 'A user adds a task.', milestones: [ms(TASKS, 'Creating tasks', ADD, 1)] }],
      noFlowClaims: [],
    }
    const res = await synth(r, [tasksArea], areaSessions({ tasks: stubborn }))
    expect(res.flows).toEqual([])
    expect(res.unsettled[0].reason).toContain('unaccounted')
    // A single-area wipeout: `flows.json` is never written, so the next run
    // re-synthesizes against whatever was committed before.
    expect(isFlowSynthesisWipeout(res)).toBe(true)
    expect(res.path).toBeUndefined()
    expect(fs.existsSync(flowsPath(r))).toBe(false)

    const second = await synth(r, [tasksArea], areaSessions({ tasks: TASK_LIFECYCLE }))
    expect(second.calls).toBe(1)
    expect(second.flows).toHaveLength(2)
  })

  it('one failing area never withholds another area flows', async () => {
    const r = repo()
    const runner = areaSessions({
      tasks: TASK_LIFECYCLE,
      accounts: { ok: false, reason: 'flows session failed: transport exploded' },
    })
    const res = await synth(r, [tasksArea, authArea], runner)

    expect(res.flows.map((f) => f.title)).toEqual([
      'Create, list and complete a task',
      'Adding a task without a title is rejected',
    ])
    expect(res.unsettled.map((u) => u.areaId)).toEqual(['accounts'])
    expect(res.unsettled[0].reason).toContain('transport exploded')
  })
})

describe('synthesizeFlows — epic pass', () => {
  const epicAnswer = {
    epics: [
      {
        title: 'Sign in and run the task lifecycle',
        goal: 'A new user signs in, works through a task, and signs out.',
        composedOf: ['F3', 'F1'],
        milestones: [
          ms(AUTH, 'Signing in', SIGN_IN, 1),
          ms(TASKS, 'Creating tasks', ADD, 2),
          ms(TASKS, 'Completing tasks', DONE, 3),
          ms(AUTH, 'Signing out', SIGN_OUT, 4),
        ],
      },
    ],
  }

  it('chains flows from two areas into an epic with composedOf provenance', async () => {
    const r = repo()
    const epics = epicSession(epicAnswer)
    const res = await synth(r, [tasksArea, authArea], areaSessions({ tasks: TASK_LIFECYCLE, accounts: AUTH_SESSION }), {
      epicSession: epics,
    })

    expect(res.unsettled).toEqual([])
    expect(res.calls).toBe(3) // two areas + one epic pass
    const epic = res.flows.find((f) => f.composedOf.length > 0)!
    expect(epic.id).toBe('sign-in-and-run-the-task-lifecycle')
    expect(epic.milestones.map((m) => m.claimTitle)).toEqual([SIGN_IN, ADD, DONE, SIGN_OUT])
    expect(epic.composedOf).toEqual(['sign-in-and-sign-out', 'create-list-and-complete-a-task'])
    // Bindings span both documents.
    expect([...new Set(epic.bindings.map((b) => b.doc))].sort()).toEqual([AUTH_DOC, TASKS_DOC])
    // The digests carry titles + milestones only — never document text.
    expect(epics.seen[0].digests.map((d) => d.ref)).toEqual(['F1', 'F2', 'F3'])
    expect(Object.keys(epics.seen[0].digests[0]).sort()).toEqual(['areaId', 'goal', 'milestones', 'ref', 'title'])
    // The epic checker's snapping set is the whole run's claim inventory.
    expect(epics.seen[0].claims).toHaveLength(TASK_CLAIMS.length + AUTH_CLAIMS.length)
  })

  it('skips the epic pass entirely when only one area produced flows', async () => {
    const r = repo()
    const epics = epicSession(epicAnswer)
    const res = await synth(r, [tasksArea], areaSessions({ tasks: TASK_LIFECYCLE }), { epicSession: epics })
    expect(epics.seen).toEqual([])
    expect(res.flows.every((f) => f.composedOf.length === 0)).toBe(true)
  })

  // The epic re-ask is retired with the area one: `check_flows` corrects in
  // session, and the fold refuses what it is still handed.
  it('REFUSES an epic whose milestone no composed flow carries, keeping the area flows', async () => {
    const r = repo()
    const bad = {
      epics: [
        {
          title: 'Bogus epic',
          goal: 'References a claim outside its composed flows.',
          composedOf: ['F1', 'F3'],
          milestones: [ms(AUTH, 'Signing in', SIGN_IN, 1), ms(TASKS, 'Creating tasks', '`relkit sync` uploads every task', 2)],
        },
      ],
    }
    const epics = epicSession(bad)
    const res = await synth(r, [tasksArea, authArea], areaSessions({ tasks: TASK_LIFECYCLE, accounts: AUTH_SESSION }), {
      epicSession: epics,
    })

    expect(epics.seen).toHaveLength(1)
    expect(res.unsettled.map((u) => u.areaId)).toEqual(['(epic)'])
    expect(res.unsettled[0].reason).toContain('epic pass refused')
    expect(res.unsettled[0].reason).toContain('relkit sync')
    expect(res.flows).toHaveLength(3)
    expect(res.flows.every((f) => f.composedOf.length === 0)).toBe(true)
  })

  it('reports the epic pass as unsettled without touching the area flows', async () => {
    const r = repo()
    const epics = epicSession({ epics: [{ title: 'x', goal: 'y', composedOf: ['F9', 'F8'], milestones: [ms(TASKS, 'Creating tasks', ADD, 1), ms(TASKS, 'Listing tasks', LIST, 2)] }] })
    const res = await synth(r, [tasksArea, authArea], areaSessions({ tasks: TASK_LIFECYCLE, accounts: AUTH_SESSION }), {
      epicSession: epics,
    })

    expect(res.unsettled.map((u) => u.areaId)).toEqual(['(epic)'])
    expect(res.flows).toHaveLength(3)
    expect(res.flows.every((f) => f.composedOf.length === 0)).toBe(true)
  })
})

describe('synthesizeFlows — subsumption post-pass', () => {
  // Plan 04 step 16: the near-duplicate is a REPORT in session (the checker
  // never deletes) and a deterministic DROP in the fold. Both halves, on the
  // same draft.
  it('the checker reports a near-duplicate cleanly; the fold is what drops it', async () => {
    const draft = {
      flows: [
        ...TASK_LIFECYCLE.flows,
        {
          title: 'Create and list a task',
          goal: 'A user adds a task and sees it listed.',
          milestones: [ms(TASKS, 'Creating tasks', ADD, 1), ms(TASKS, 'Listing tasks', LIST, 2)],
        },
      ],
      noFlowClaims: [],
    }
    const report = checkFlowSet(draft, { area: tasksArea })
    // Reported, not refused — the session may still produce it.
    expect(report.subsumed).toEqual([
      { title: 'Create and list a task', supersededBy: 'Create, list and complete a task' },
    ])
    expect(isFlowSetClean(report)).toBe(true)

    const res = await synth(repo(), [tasksArea], areaSessions({ tasks: draft }))
    expect(res.flows.map((f) => f.title)).not.toContain('Create and list a task')
    expect(res.subsumed).toEqual(report.subsumed)
  })

  it('drops a flow whose path is a contiguous subsequence of a sibling', async () => {
    const r = repo()
    const res = await synth(
      r,
      [tasksArea],
      areaSessions({
        tasks: {
          flows: [
            ...TASK_LIFECYCLE.flows,
            {
              title: 'Create and list a task',
              goal: 'A user adds a task and sees it listed.',
              milestones: [ms(TASKS, 'Creating tasks', ADD, 1), ms(TASKS, 'Listing tasks', LIST, 2)],
            },
          ],
          noFlowClaims: [],
        },
      }),
    )

    expect(res.flows.map((f) => f.title)).toEqual([
      'Create, list and complete a task',
      'Adding a task without a title is rejected',
    ])
    expect(res.subsumed).toEqual([
      { title: 'Create and list a task', supersededBy: 'Create, list and complete a task' },
    ])
  })

  it('keeps a flow whose path is not CONTIGUOUS inside the sibling', async () => {
    const r = repo()
    const res = await synth(
      r,
      [tasksArea],
      areaSessions({
        tasks: {
          flows: [
            ...TASK_LIFECYCLE.flows,
            {
              title: 'Create then complete',
              goal: 'A user adds a task and completes it without listing.',
              milestones: [ms(TASKS, 'Creating tasks', ADD, 1), ms(TASKS, 'Completing tasks', DONE, 2)],
            },
          ],
          noFlowClaims: [],
        },
      }),
    )
    expect(res.subsumed).toEqual([])
    expect(res.flows).toHaveLength(3)
  })

  it('keeps exactly one of two identical flows, and every section stays bound', async () => {
    const r = repo()
    const duplicate = {
      title: 'Reject an empty title',
      goal: 'The same path, worded differently.',
      milestones: [ms(TASKS, 'Creating tasks', ADD_EMPTY, 1)],
    }
    const res = await synth(
      r,
      [tasksArea],
      areaSessions({ tasks: { flows: [...TASK_LIFECYCLE.flows, duplicate], noFlowClaims: [] } }),
    )

    // The empty-title claim keeps exactly one flow — mutual subsumption never
    // drops both — and the coverage gate leaves every section bound.
    const emptyTitleFlows = res.flows.filter((f) => f.milestones.some((m) => m.claimTitle === ADD_EMPTY))
    expect(emptyTitleFlows).toHaveLength(1)
    expect(emptyTitleFlows[0].title).toBe('Adding a task without a title is rejected')
    expect(res.subsumed).toEqual([{ title: 'Reject an empty title', supersededBy: 'Adding a task without a title is rejected' }])
    const boundSections = new Set(res.flows.flatMap((f) => f.bindings.map((b) => b.anchor)))
    expect([...boundSections].sort()).toEqual(
      [TASKS.anchors['Creating tasks'], TASKS.anchors['Listing tasks'], TASKS.anchors['Completing tasks']].sort(),
    )
  })

  it('never lets an epic subsume the flows it composes', async () => {
    const r = repo()
    const epics = epicSession({
      epics: [
        {
          title: 'Full session',
          goal: 'Sign in, run the whole task lifecycle, sign out.',
          composedOf: ['F1', 'F3'],
          milestones: [
            ms(AUTH, 'Signing in', SIGN_IN, 1),
            ms(TASKS, 'Creating tasks', ADD, 2),
            ms(TASKS, 'Listing tasks', LIST, 3),
            ms(TASKS, 'Completing tasks', DONE, 4),
            ms(TASKS, 'Completing tasks', LIST_DONE, 5),
            ms(AUTH, 'Signing out', SIGN_OUT, 6),
          ],
        },
      ],
    })
    const res = await synth(r, [tasksArea, authArea], areaSessions({ tasks: TASK_LIFECYCLE, accounts: AUTH_SESSION }), {
      epicSession: epics,
    })

    expect(res.subsumed).toEqual([])
    expect(res.flows.map((f) => f.title)).toContain('Create, list and complete a task')
    expect(res.flows.map((f) => f.title)).toContain('Sign in and sign out')
    expect(res.flows).toHaveLength(4)
  })
})

describe('synthesizeFlows — the id stem is length-capped and order-free', () => {
  // A flow title can be a whole sentence; `<flow-id>.<surface>.<n>.yaml` still has
  // to be writable, and two long titles that agree for their first 60 characters
  // must not depend on synthesis ORDER to be told apart.
  const PREFIX =
    'Adding a task whose title exceeds the maximum supported length is rejected with a clear message about'
  const LONG_A = `${PREFIX} the title`
  const LONG_B = `${PREFIX} the limit`

  const MILESTONE: Record<string, ReturnType<typeof ms>[]> = {
    [LONG_A]: [ms(TASKS, 'Creating tasks', ADD_EMPTY, 1)],
    [LONG_B]: [
      ms(TASKS, 'Creating tasks', ADD, 1),
      ms(TASKS, 'Listing tasks', LIST, 2),
      ms(TASKS, 'Completing tasks', DONE, 3),
      ms(TASKS, 'Completing tasks', LIST_DONE, 4),
    ],
  }

  function longFlows(order: readonly string[]) {
    return {
      flows: order.map((title) => ({
        title,
        goal: 'A user is told why the title was refused.',
        milestones: MILESTONE[title],
      })),
      noFlowClaims: [],
    }
  }

  it('caps the stem and hashes the full slug, so two long titles stay distinct in either order', async () => {
    const forward = await synth(repo(), [tasksArea], areaSessions({ tasks: longFlows([LONG_A, LONG_B]) }))
    const reversed = await synth(repo(), [tasksArea], areaSessions({ tasks: longFlows([LONG_B, LONG_A]) }))

    const [idA, idB] = forward.flows.map((f) => f.id)
    expect(idA).not.toBe(idB)
    // Capped stem + an 8-hex hash of the full slug — never a bare `-2` suffix.
    for (const id of [idA, idB]) {
      expect(id.length).toBeLessThanOrEqual(70)
      expect(id).toMatch(/-[0-9a-f]{8}$/)
    }
    // The id is a function of the title alone: reversing synthesis order swaps the
    // rows but not the handles.
    expect(reversed.flows.map((f) => f.id)).toEqual([idB, idA])
  })

  it('leaves a title that fits the cap byte-identical (no hash suffix)', async () => {
    const res = await synth(repo(), [tasksArea], areaSessions({ tasks: TASK_LIFECYCLE }))
    expect(res.flows.map((f) => f.id)).toEqual([
      'create-list-and-complete-a-task',
      'adding-a-task-without-a-title-is-rejected',
    ])
  })
})

describe('synthesizeFlows — identity across re-synthesis', () => {
  async function baseline(): Promise<GuardFlow[]> {
    const r = repo()
    const res = await synth(r, [tasksArea], areaSessions({ tasks: TASK_LIFECYCLE }))
    return res.flows
  }

  it('REMAPS an identical milestone set: the id survives a retitled flow', async () => {
    const previous = await baseline()
    const r = repo()
    const retitled = {
      flows: [
        { ...TASK_LIFECYCLE.flows[0], title: 'Task lifecycle, end to end' },
        TASK_LIFECYCLE.flows[1],
      ],
      noFlowClaims: [],
    }
    const res = await synth(r, [tasksArea], areaSessions({ tasks: retitled }), { previous })

    expect(res.flows[0].id).toBe('create-list-and-complete-a-task')
    expect(res.flows[0].title).toBe('Task lifecycle, end to end')
    expect(res.orphaned).toEqual([])
  })

  it('goes STALE in place on majority overlap (keeps the id, new fingerprint)', async () => {
    const previous = await baseline()
    const r = repo()
    const shortened = {
      flows: [
        {
          title: 'Create, list and complete a task',
          goal: 'The lifecycle without the completed filter.',
          milestones: [
            ms(TASKS, 'Creating tasks', ADD, 1),
            ms(TASKS, 'Listing tasks', LIST, 2),
            ms(TASKS, 'Completing tasks', DONE, 3),
          ],
        },
        TASK_LIFECYCLE.flows[1],
      ],
      noFlowClaims: [
        { doc: TASKS_DOC, anchor: TASKS.anchors['Completing tasks'], claimTitle: LIST_DONE, reason: 'a filter, not a flow step' },
      ],
    }
    const res = await synth(r, [tasksArea], areaSessions({ tasks: shortened }), { previous })

    expect(res.flows[0].id).toBe('create-list-and-complete-a-task')
    expect(res.flows[0].fingerprint).not.toBe(previous[0].fingerprint)
    expect(res.orphaned).toEqual([])
    expect(res.noFlowClaims.map((c) => c.claimTitle)).toEqual([LIST_DONE])
  })

  it('ORPHANS a prior flow nothing claims, and gives the newcomer a fresh id', async () => {
    const previous = await baseline()
    const r = repo()
    const rebuilt = {
      flows: [
        {
          title: 'Adding a task without a title is rejected',
          goal: 'A user who omits the title gets a clear error.',
          milestones: [ms(TASKS, 'Creating tasks', ADD_EMPTY, 1)],
        },
        {
          title: 'Browse the completed tasks',
          goal: 'A user reviews what they have finished.',
          milestones: [ms(TASKS, 'Completing tasks', LIST_DONE, 1)],
        },
      ],
      noFlowClaims: [
        { doc: TASKS_DOC, anchor: TASKS.anchors['Creating tasks'], claimTitle: ADD, reason: 'covered as a precondition elsewhere' },
        { doc: TASKS_DOC, anchor: TASKS.anchors['Listing tasks'], claimTitle: LIST, reason: 'covered as a precondition elsewhere' },
        { doc: TASKS_DOC, anchor: TASKS.anchors['Completing tasks'], claimTitle: DONE, reason: 'covered as a precondition elsewhere' },
      ],
    }
    const res = await synth(r, [tasksArea], areaSessions({ tasks: rebuilt }), { previous })

    expect(res.orphaned.map((f) => f.id)).toEqual(['create-list-and-complete-a-task'])
    expect(res.flows.map((f) => f.id)).toEqual(['adding-a-task-without-a-title-is-rejected', 'browse-the-completed-tasks'])
  })

  it('disambiguates two same-titled flows with -N', async () => {
    const r = repo()
    const res = await synth(
      r,
      [tasksArea],
      areaSessions({
        tasks: {
          flows: [
            { title: 'Work with tasks', goal: 'Create and list.', milestones: [ms(TASKS, 'Creating tasks', ADD, 1), ms(TASKS, 'Listing tasks', LIST, 2)] },
            { title: 'Work with tasks', goal: 'Complete and filter.', milestones: [ms(TASKS, 'Completing tasks', DONE, 1), ms(TASKS, 'Completing tasks', LIST_DONE, 2)] },
            { title: 'Work with tasks', goal: 'Reject an empty title.', milestones: [ms(TASKS, 'Creating tasks', ADD_EMPTY, 1)] },
          ],
          noFlowClaims: [],
        },
      }),
    )
    expect(res.flows.map((f) => f.id)).toEqual(['work-with-tasks', 'work-with-tasks-2', 'work-with-tasks-3'])
  })
})

// The per-area/epic CACHE moved to the session seam in `@truecourse/core`
// (`guard/flows`, keyed on the session prompt fingerprint + the same claim /
// outline material) — `synthesizeFlows` no longer caches anything, so the
// three cache cases that lived here are gone. What remains engine-side is the
// stamp: whatever key the seam probed becomes the flows' `synthesisInputsHash`.
// The keys themselves are pinned in `tests/core/guard-generate-flows-session.test.ts`.
describe('synthesizeFlows — the inputs stamp and the write gate', () => {
  it('stamps the seam’s inputsKey onto every flow it produced, epics included', async () => {
    const r = repo()
    const areaSeam: FlowsAreaSessionSeam = async ({ areas }) => ({
      byArea: new Map(
        areas.map((a) => [
          a.areaId,
          { ok: true as const, value: a.areaId === 'tasks' ? TASK_LIFECYCLE : AUTH_SESSION, inputsKey: `K:${a.areaId}` },
        ]),
      ),
      summary: sessionSummary(FLOWS_KIND, { ran: areas.length }),
    })
    const epics: FlowsEpicSessionSeam = async () => ({
      result: {
        ok: true,
        value: {
          epics: [
            {
              title: 'Sign in and create a task',
              goal: 'A new user signs in and adds a task.',
              composedOf: ['F3', 'F1'],
              milestones: [ms(AUTH, 'Signing in', SIGN_IN, 1), ms(TASKS, 'Creating tasks', ADD, 2)],
            },
          ],
        },
        inputsKey: 'K:epic',
      },
      summary: sessionSummary(FLOWS_KIND, { ran: 1 }),
    })
    const res = await synth(r, [tasksArea, authArea], areaSeam, { epicSession: epics })

    expect(res.unsettled).toEqual([])
    const byId = new Map(res.flows.map((f) => [f.id, f.synthesisInputsHash]))
    expect(byId.get('create-list-and-complete-a-task')).toBe('K:tasks')
    expect(byId.get('sign-in-and-sign-out')).toBe('K:accounts')
    expect(byId.get('sign-in-and-create-a-task')).toBe('K:epic')
  })

  it('write: false computes the corpus without touching flows.json', async () => {
    const r = repo()
    const res = await synth(r, [tasksArea], areaSessions({ tasks: TASK_LIFECYCLE }), { write: false })
    expect(res.path).toBeUndefined()
    expect(fs.existsSync(flowsPath(r))).toBe(false)
    expect(res.flows).toHaveLength(2)
  })

  // The wipeout guard: a run that SPENT sessions and produced no flow at all
  // is a loss, and the committable corpus is never rewritten with it.
  it('never rewrites a committed flows.json on a wipeout', async () => {
    const r = repo()
    const first = await synth(r, [tasksArea], areaSessions({ tasks: TASK_LIFECYCLE }))
    expect(first.path).toBe(flowsPath(r))
    const committed = fs.readFileSync(flowsPath(r), 'utf-8')

    const wiped = await synth(r, [tasksArea], areaSessions({ tasks: { ok: false, reason: 'flows session failed: gone' } }))
    expect(isFlowSynthesisWipeout(wiped)).toBe(true)
    expect(wiped.flows).toEqual([])
    expect(wiped.unsettled).toHaveLength(1)
    expect(wiped.calls).toBe(1)
    expect(wiped.path).toBeUndefined()
    expect(fs.readFileSync(flowsPath(r), 'utf-8')).toBe(committed)
  })

  // An area with no claims at all spends a session and legitimately produces
  // no flow: that is an empty corpus, not a loss, and it IS written.
  it('writes an empty corpus when a session honestly produced no flows', async () => {
    const r = repo()
    const emptyArea: FlowSynthesisArea = { areaId: 'tasks', claims: [], docs: [{ doc: TASKS_DOC, outline: TASKS.outline }] }
    const res = await synth(r, [emptyArea], areaSessions({ tasks: { flows: [], noFlowClaims: [] } }))
    expect(isFlowSynthesisWipeout(res)).toBe(false)
    expect(res.unsettled).toEqual([])
    expect(res.flows).toEqual([])
    expect(res.path).toBe(flowsPath(r))
  })

  // The predicate's whole truth table, on its own terms: a wipeout is an empty
  // corpus AND a reported failure AND spend. Drop any one and it is not a loss.
  it('isFlowSynthesisWipeout needs all three: no flows, an unsettled area, and spend', () => {
    const unsettled = [{ areaId: 'tasks', reason: 'flow synthesis refused: …' }]
    expect(isFlowSynthesisWipeout({ flows: [], unsettled, calls: 1 })).toBe(true)
    // Nothing was spent — a run that never reached a session is not a loss.
    expect(isFlowSynthesisWipeout({ flows: [], unsettled, calls: 0 })).toBe(false)
    // Everything settled and the corpus is honestly empty.
    expect(isFlowSynthesisWipeout({ flows: [], unsettled: [], calls: 1 })).toBe(false)
    // One area lost, another produced flows: fail-soft, never an abort.
    expect(
      isFlowSynthesisWipeout({ flows: [{ id: 'f' }] as unknown as FlowSynthesisResult['flows'], unsettled, calls: 2 }),
    ).toBe(false)
  })
})

describe('buildFlowAreas — the one grouping rule', () => {
  it('groups docs by their first corpus area tag and gives untagged docs their own area', () => {
    const areas = buildFlowAreas([
      { doc: TASKS_DOC, areaTags: ['tasks', 'core'], outline: TASKS.outline, claims: TASK_CLAIMS },
      { doc: 'docs/tasks-cli.md', areaTags: ['tasks'], outline: [], claims: [] },
      { doc: AUTH_DOC, areaTags: [], outline: AUTH.outline, claims: AUTH_CLAIMS },
    ])

    expect(areas.map((a) => a.areaId)).toEqual([`doc:${AUTH_DOC}`, 'tasks'])
    const tasks = areas.find((a) => a.areaId === 'tasks')!
    expect(tasks.docs.map((d) => d.doc)).toEqual([TASKS_DOC, 'docs/tasks-cli.md'])
    expect(tasks.claims).toHaveLength(TASK_CLAIMS.length)
  })
})

describe('flows.json', () => {
  it('lands next to the manifest in the committable scenarios store', () => {
    const r = repo()
    expect(flowsPath(r)).toBe(path.join(r, '.truecourse', 'scenarios', 'flows.json'))
  })
})
