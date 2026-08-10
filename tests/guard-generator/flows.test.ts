import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildDocSectionIndex } from '@truecourse/guard-runner'
import {
  synthesizeFlows,
  planFlowSynthesis,
  buildFlowAreas,
  flowSectionKey,
  flowsPath,
  readFlowsFile,
  type FlowSynthesisArea,
  type FlowsRunner,
  type FlowsEpicRunner,
  type FlowsUserContext,
  type FlowsEpicUserContext,
  type FlowClaimInput,
} from '@truecourse/guard-generator'
import { GuardFlowsFileSchema, type GuardFlow } from '@truecourse/shared'
import { makeTempRepo, rmrf } from './helpers.js'

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

/** A flows runner answering per area, recording every context it was handed. */
function flowsRunner(
  answers: Record<string, unknown | ((ctx: FlowsUserContext, attempt: number) => unknown)>,
  seen: FlowsUserContext[] = [],
): FlowsRunner & { seen: FlowsUserContext[] } {
  const attempts = new Map<string, number>()
  const runner = (async (ctx: FlowsUserContext) => {
    seen.push(ctx)
    const attempt = attempts.get(ctx.areaId) ?? 0
    attempts.set(ctx.areaId, attempt + 1)
    const answer = answers[ctx.areaId]
    if (typeof answer === 'function') return (answer as (c: FlowsUserContext, a: number) => unknown)(ctx, attempt)
    return answer ?? { flows: [], noFlowClaims: [] }
  }) as FlowsRunner & { seen: FlowsUserContext[] }
  runner.seen = seen
  return runner
}

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
  runner: FlowsRunner,
  extra: Partial<Parameters<typeof synthesizeFlows>[0]> = {},
) {
  return synthesizeFlows({
    repoRoot: r,
    areas,
    runner,
    sectionFingerprints: FINGERPRINTS,
    now: () => new Date('2026-07-24T00:00:00.000Z'),
    ...extra,
  })
}

describe('synthesizeFlows — composition', () => {
  it('composes a composite and an atomic flow, binds their sections, and writes flows.json', async () => {
    const r = repo()
    const runner = flowsRunner({ tasks: TASK_LIFECYCLE })
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

  it('the synthesis prompt carries claims and outlines only — no code, probes, or recipe', async () => {
    const r = repo()
    const runner = flowsRunner({ tasks: TASK_LIFECYCLE })
    await synth(r, [tasksArea], runner)

    const ctx = runner.seen[0]
    expect(ctx.areaId).toBe('tasks')
    expect(ctx.claims.map((c) => c.claim)).toEqual([ADD, ADD_EMPTY, LIST, DONE, LIST_DONE])
    expect(ctx.claims.every((c) => c.required)).toBe(true)
    expect(ctx.docs.map((d) => d.doc)).toEqual([TASKS_DOC])
    expect(JSON.stringify(ctx)).not.toContain('recipe')
  })

  it('marks claims on non-runnable surfaces optional for coverage accounting', async () => {
    const r = repo()
    const area: FlowSynthesisArea = {
      ...tasksArea,
      claims: [...TASK_CLAIMS, claim(TASKS, 'Listing tasks', 'the board shows one card per open task', 'web')],
    }
    const runner = flowsRunner({ tasks: TASK_LIFECYCLE })
    const res = await synth(r, [area], runner)

    // The web claim is never accounted for, so nothing is re-asked.
    expect(res.calls).toBe(1)
    expect(res.unsettled).toEqual([])
    expect(runner.seen[0].claims.find((c) => c.driver === 'web')!.required).toBe(false)
  })

  it('records a claim whose section is not in the live index as a no-flow claim', async () => {
    const r = repo()
    const area: FlowSynthesisArea = {
      ...tasksArea,
      claims: [...TASK_CLAIMS, { doc: TASKS_DOC, anchor: 'tasks/deleted-section', title: 'stale claim', driver: 'cli' }],
    }
    const res = await synth(r, [area], flowsRunner({ tasks: TASK_LIFECYCLE }))
    expect(res.noFlowClaims.map((c) => c.claimTitle)).toContain('stale claim')
    expect(res.flows.flatMap((f) => f.milestones).some((m) => m.claimTitle === 'stale claim')).toBe(false)
  })
})

describe('synthesizeFlows — milestone snapping and validation', () => {
  it('snaps a paraphrased milestone onto its claim without a re-ask', async () => {
    const r = repo()
    const runner = flowsRunner({
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

  it('rejects a milestone that matches no claim and re-asks ONCE with the reference quoted', async () => {
    const r = repo()
    const runner = flowsRunner({
      tasks: (_ctx, attempt) =>
        attempt === 0
          ? {
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
            }
          : TASK_LIFECYCLE,
    })
    const res = await synth(r, [tasksArea], runner)

    expect(res.calls).toBe(2)
    expect(res.unsettled).toEqual([])
    expect(res.flows).toHaveLength(2)
    const reask = runner.seen[1]
    expect(reask.issues!.unknownReferences).toHaveLength(1)
    expect(reask.issues!.unknownReferences[0]).toContain('relkit archive')
    // Everything else is asked again unchanged — the re-ask is a correction, not a delta.
    expect(reask.claims).toEqual(runner.seen[0].claims)
  })

  it('re-asks once when a malformed reply fails the schema', async () => {
    const r = repo()
    const runner = flowsRunner({ tasks: (_c, attempt) => (attempt === 0 ? { nonsense: true } : TASK_LIFECYCLE) })
    const res = await synth(r, [tasksArea], runner)

    expect(res.calls).toBe(2)
    expect(runner.seen[1].correction!.invalidOutput).toContain('nonsense')
    expect(res.flows).toHaveLength(2)
  })
})

describe('synthesizeFlows — coverage honesty rule', () => {
  it('re-asks with the unaccounted claims, then settles when they are covered', async () => {
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
    const runner = flowsRunner({ tasks: (_c, attempt) => (attempt === 0 ? partial : TASK_LIFECYCLE) })
    const res = await synth(r, [tasksArea], runner)

    expect(res.calls).toBe(2)
    const uncovered = runner.seen[1].issues!.uncoveredClaims
    expect(uncovered).toHaveLength(3)
    expect(uncovered.join('\n')).toContain(ADD_EMPTY)
    expect(res.unsettled).toEqual([])
  })

  it('a stated no-flow reason satisfies the rule, and lands in flows.json', async () => {
    const r = repo()
    const res = await synth(
      r,
      [tasksArea],
      flowsRunner({
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

  it('leaves the area UNSETTLED (no flows, nothing cached) when coverage never lands', async () => {
    const r = repo()
    const stubborn = {
      flows: [
        {
          title: 'Create a task',
          goal: 'A user adds a task.',
          milestones: [ms(TASKS, 'Creating tasks', ADD, 1)],
        },
      ],
      noFlowClaims: [],
    }
    const runner = flowsRunner({ tasks: stubborn })
    const res = await synth(r, [tasksArea], runner)

    expect(res.calls).toBe(2)
    expect(res.flows).toEqual([])
    expect(res.unsettled).toHaveLength(1)
    expect(res.unsettled[0].areaId).toBe('tasks')
    expect(res.unsettled[0].reason).toContain('unaccounted')

    // Nothing was cached, so the next run re-attempts the area from scratch.
    const again = flowsRunner({ tasks: TASK_LIFECYCLE })
    const second = await synth(r, [tasksArea], again)
    expect(second.calls).toBe(1)
    expect(second.flows).toHaveLength(2)
  })

  it('one failing area never withholds another area flows', async () => {
    const r = repo()
    const runner = flowsRunner({
      tasks: TASK_LIFECYCLE,
      accounts: () => {
        throw new Error('transport exploded')
      },
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

  function epicRunner(
    answer: unknown | ((ctx: FlowsEpicUserContext, attempt: number) => unknown),
    seen: FlowsEpicUserContext[] = [],
  ): FlowsEpicRunner & { seen: FlowsEpicUserContext[] } {
    let attempt = 0
    const runner = (async (ctx: FlowsEpicUserContext) => {
      seen.push(ctx)
      const a = attempt++
      return typeof answer === 'function' ? (answer as (c: FlowsEpicUserContext, n: number) => unknown)(ctx, a) : answer
    }) as FlowsEpicRunner & { seen: FlowsEpicUserContext[] }
    runner.seen = seen
    return runner
  }

  it('chains flows from two areas into an epic with composedOf provenance', async () => {
    const r = repo()
    const epics = epicRunner(epicAnswer)
    const res = await synth(r, [tasksArea, authArea], flowsRunner({ tasks: TASK_LIFECYCLE, accounts: AUTH_SESSION }), {
      epicRunner: epics,
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
  })

  it('skips the epic pass entirely when only one area produced flows', async () => {
    const r = repo()
    const epics = epicRunner(epicAnswer)
    const res = await synth(r, [tasksArea], flowsRunner({ tasks: TASK_LIFECYCLE }), { epicRunner: epics })
    expect(epics.seen).toEqual([])
    expect(res.flows.every((f) => f.composedOf.length === 0)).toBe(true)
  })

  it('rejects an epic milestone that no composed flow carries, then accepts the corrected answer', async () => {
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
    const epics = epicRunner((_c, attempt) => (attempt === 0 ? bad : epicAnswer))
    const res = await synth(r, [tasksArea, authArea], flowsRunner({ tasks: TASK_LIFECYCLE, accounts: AUTH_SESSION }), {
      epicRunner: epics,
    })

    expect(epics.seen).toHaveLength(2)
    expect(epics.seen[1].issues!.unknownReferences[0]).toContain('relkit sync')
    expect(res.flows.some((f) => f.composedOf.length === 2)).toBe(true)
  })

  it('reports the epic pass as unsettled without touching the area flows', async () => {
    const r = repo()
    const epics = epicRunner({ epics: [{ title: 'x', goal: 'y', composedOf: ['F9', 'F8'], milestones: [ms(TASKS, 'Creating tasks', ADD, 1), ms(TASKS, 'Listing tasks', LIST, 2)] }] })
    const res = await synth(r, [tasksArea, authArea], flowsRunner({ tasks: TASK_LIFECYCLE, accounts: AUTH_SESSION }), {
      epicRunner: epics,
    })

    expect(res.unsettled.map((u) => u.areaId)).toEqual(['(epic)'])
    expect(res.flows).toHaveLength(3)
    expect(res.flows.every((f) => f.composedOf.length === 0)).toBe(true)
  })
})

describe('synthesizeFlows — subsumption post-pass', () => {
  it('drops a flow whose path is a contiguous subsequence of a sibling', async () => {
    const r = repo()
    const res = await synth(
      r,
      [tasksArea],
      flowsRunner({
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
      flowsRunner({
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
      flowsRunner({ tasks: { flows: [...TASK_LIFECYCLE.flows, duplicate], noFlowClaims: [] } }),
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
    const epics: FlowsEpicRunner = async () => ({
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
    const res = await synth(r, [tasksArea, authArea], flowsRunner({ tasks: TASK_LIFECYCLE, accounts: AUTH_SESSION }), {
      epicRunner: epics,
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
    const forward = await synth(repo(), [tasksArea], flowsRunner({ tasks: longFlows([LONG_A, LONG_B]) }))
    const reversed = await synth(repo(), [tasksArea], flowsRunner({ tasks: longFlows([LONG_B, LONG_A]) }))

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
    const res = await synth(repo(), [tasksArea], flowsRunner({ tasks: TASK_LIFECYCLE }))
    expect(res.flows.map((f) => f.id)).toEqual([
      'create-list-and-complete-a-task',
      'adding-a-task-without-a-title-is-rejected',
    ])
  })
})

describe('synthesizeFlows — identity across re-synthesis', () => {
  async function baseline(): Promise<GuardFlow[]> {
    const r = repo()
    const res = await synth(r, [tasksArea], flowsRunner({ tasks: TASK_LIFECYCLE }))
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
    const res = await synth(r, [tasksArea], flowsRunner({ tasks: retitled }), { previous })

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
    const res = await synth(r, [tasksArea], flowsRunner({ tasks: shortened }), { previous })

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
    const res = await synth(r, [tasksArea], flowsRunner({ tasks: rebuilt }), { previous })

    expect(res.orphaned.map((f) => f.id)).toEqual(['create-list-and-complete-a-task'])
    expect(res.flows.map((f) => f.id)).toEqual(['adding-a-task-without-a-title-is-rejected', 'browse-the-completed-tasks'])
  })

  it('disambiguates two same-titled flows with -N', async () => {
    const r = repo()
    const res = await synth(
      r,
      [tasksArea],
      flowsRunner({
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

describe('synthesizeFlows — caching', () => {
  it('re-runs on an unchanged inventory with ZERO transport calls and identical ids', async () => {
    const r = repo()
    const first = await synth(r, [tasksArea], flowsRunner({ tasks: TASK_LIFECYCLE }))
    expect(first.calls).toBe(1)

    const exploding: FlowsRunner = async () => {
      throw new Error('the cache should have answered')
    }
    const second = await synth(r, [tasksArea], exploding)
    expect(second.calls).toBe(0)
    expect(second.unsettled).toEqual([])
    expect(second.flows.map((f) => f.id)).toEqual(first.flows.map((f) => f.id))
    expect(second.flows.map((f) => f.fingerprint)).toEqual(first.flows.map((f) => f.fingerprint))
  })

  it('a changed claim inventory misses the cache and re-synthesizes that area only', async () => {
    const r = repo()
    await synth(r, [tasksArea, authArea], flowsRunner({ tasks: TASK_LIFECYCLE, accounts: AUTH_SESSION }))

    const changedTasks: FlowSynthesisArea = {
      ...tasksArea,
      claims: [...TASK_CLAIMS, claim(TASKS, 'Listing tasks', '`relkit list --json` prints the open tasks as JSON')],
    }
    const runner = flowsRunner({
      tasks: {
        flows: [
          ...TASK_LIFECYCLE.flows,
          {
            title: 'Read the task list as JSON',
            goal: 'A script consumes the open tasks.',
            milestones: [ms(TASKS, 'Listing tasks', '`relkit list --json` prints the open tasks as JSON', 1)],
          },
        ],
        noFlowClaims: [],
      },
      accounts: AUTH_SESSION,
    })
    const res = await synth(r, [changedTasks, authArea], runner)

    expect(res.calls).toBe(1)
    expect(runner.seen.map((c) => c.areaId)).toEqual(['tasks'])
    expect(res.flows.map((f) => f.id)).toContain('read-the-task-list-as-json')
  })

  it('the epic pass is cached on the flow digests', async () => {
    const r = repo()
    let epicCalls = 0
    const epics: FlowsEpicRunner = async () => {
      epicCalls++
      return { epics: [] }
    }
    await synth(r, [tasksArea, authArea], flowsRunner({ tasks: TASK_LIFECYCLE, accounts: AUTH_SESSION }), { epicRunner: epics })
    expect(epicCalls).toBe(1)

    const cached = await synth(r, [tasksArea, authArea], flowsRunner({}), { epicRunner: epics })
    expect(epicCalls).toBe(1)
    expect(cached.calls).toBe(0)
  })

  it('write: false computes the corpus without touching flows.json', async () => {
    const r = repo()
    const res = await synth(r, [tasksArea], flowsRunner({ tasks: TASK_LIFECYCLE }), { write: false })
    expect(res.path).toBeUndefined()
    expect(fs.existsSync(flowsPath(r))).toBe(false)
    expect(res.flows).toHaveLength(2)
  })
})

describe('planFlowSynthesis — the planner the estimate and the run share', () => {
  it('plans a call for every uncached area, and none once they are cached', async () => {
    const r = repo()
    const areas = [tasksArea, authArea]

    const cold = await planFlowSynthesis(r, areas)
    expect(cold.areaCalls).toBe(2)
    expect(cold.epicCalls).toBe(1)
    expect(cold.maxFlows).toBe(TASK_CLAIMS.length + AUTH_CLAIMS.length)
    expect(cold.areas.every((a) => !a.cached)).toBe(true)

    const runner = flowsRunner({ tasks: TASK_LIFECYCLE, accounts: AUTH_SESSION })
    const res = await synth(r, areas, runner)
    // Estimate planned a call ⇔ the run made one.
    expect(res.calls).toBe(cold.areaCalls)

    const warm = await planFlowSynthesis(r, areas)
    expect(warm.areaCalls).toBe(0)
    expect(warm.areas.every((a) => a.cached)).toBe(true)
    const rerun = await synth(r, areas, flowsRunner({}))
    expect(rerun.calls).toBe(0)
  })

  it('a single area needs no epic pass', async () => {
    const plan = await planFlowSynthesis(repo(), [tasksArea])
    expect(plan.epicCalls).toBe(0)
  })

  it('counts only runnable claims toward the flow bound', async () => {
    const area: FlowSynthesisArea = {
      ...tasksArea,
      claims: [...TASK_CLAIMS, claim(TASKS, 'Listing tasks', 'the board shows one card per open task', 'web')],
    }
    const plan = await planFlowSynthesis(repo(), [area])
    expect(plan.areas[0].claims).toBe(6)
    expect(plan.areas[0].runnableClaims).toBe(5)
    expect(plan.maxFlows).toBe(5)
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
