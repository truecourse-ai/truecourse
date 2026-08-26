/**
 * THE FLOW-SYNTHESIS SESSIONS — `guard-generate.flows` (plan 04 step 16): one
 * session per AREA, one epic session after them.
 *
 * What is pinned here is the SESSION half — the defs through the real
 * `runAgentLoop`, the `check_flows` validator tool, the briefings (claims,
 * outlines, grounding), the cache keys, and the refusal the seam's
 * `rejectOutput` derives. The engine's FOLD (snapping, coverage, subsumption,
 * identity, the wipeout guard) is pinned in `tests/guard-generator/flows.test.ts`
 * against the same checker — the two must agree, and the parity case below says
 * so explicitly.
 *
 * The one-shot flows stage was DELETED by step 20, so the plan's "compare the
 * checker with the one-shot post-passes" is no longer executable as written.
 * The parity that still exists — and is the load-bearing one — is `check_flows`
 * (in-session) versus the fold's own re-validation: a draft the tool passes must
 * fold, and a draft it refuses must land the area unsettled.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { buildDocSectionIndex } from '@truecourse/guard-runner'
import {
  checkEpicSet,
  checkFlowSet,
  collectWorkDocs,
  flowAreaClaimsMaterial,
  flowAreaOutlinesMaterial,
  flowSectionKey,
  generateGuards,
  isFlowSetClean,
  planGuardWork,
  synthesizeFlows,
  type FlowClaimInput,
  type FlowDigest,
  type FlowSet,
  type FlowSynthesisArea,
  type FlowsSessionGrounding,
  type GuardDoc,
} from '@truecourse/guard-generator'
import { interfaceFingerprint, type Interface } from '@truecourse/shared'
import { runAgentLoop, type SessionRunInput } from '../../packages/agent-loop/src/index'
import {
  FLOWS_EPIC_SESSION_PROMPT_FINGERPRINT,
  FLOWS_EPIC_SESSION_SYSTEM_PROMPT,
  FLOWS_EPIC_WORK_ITEM,
  FLOWS_SESSION_BUDGET,
  FLOWS_SESSION_CACHE_NAME,
  FLOWS_SESSION_KIND,
  FLOWS_SESSION_PROMPT_FINGERPRINT,
  FLOWS_SESSION_SYSTEM_PROMPT,
  flowSetRefusalReason,
  flowsEpicSessionBriefing,
  flowsEpicSessionCacheKey,
  flowsEpicSessionDef,
  flowsSessionBriefing,
  flowsSessionCacheKey,
  flowsSessionDef,
  flowsSessionWorkItem,
  type FlowsCheckerContext,
} from '../../packages/core/src/services/guard-generate/index'
import { buildGuardDocUniverse } from '../../packages/core/src/services/guard-generate/index'
import { memoryPersistence, stubDriver, outcome } from './spec-scan-session-stub'
import {
  DEFAULT_INTERFACES,
  extractSessionBy,
  flowsAreaSessionOf,
  interfacesOf,
  makeTempRepo,
  noEpicSessions,
  noWorkerSessions,
  rmrf,
  writeCorpus,
  writeDoc,
  writeRecipe,
} from '../guard-generator/helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

// ---------------------------------------------------------------------------
// One real, indexed document — anchors and fingerprints a run would bind.
// ---------------------------------------------------------------------------

const DOC = 'docs/tasks.md'
const CONTENT = [
  '# Tasks',
  '',
  '## Creating tasks',
  '',
  '`relkit add <title>` creates a task and prints its id as `t<N>`.',
  '',
  '## Listing tasks',
  '',
  '`relkit list` prints one line per open task, newest first.',
  '',
  '## Completing tasks',
  '',
  '`relkit done <id>` marks the task complete.',
].join('\n')

const INDEX = buildDocSectionIndex(DOC, CONTENT)
const anchorOf = (heading: string): string => INDEX.sections.find((s) => s.headingText === heading)!.anchor
const CREATE = anchorOf('Creating tasks')
const LIST = anchorOf('Listing tasks')
const DONE = anchorOf('Completing tasks')
const SECTION_KEYS = new Set(INDEX.sections.map((s) => flowSectionKey(DOC, s.anchor)))
const FINGERPRINTS = new Map(INDEX.sections.map((s) => [flowSectionKey(DOC, s.anchor), s.fingerprint]))

const ADD = '`relkit add <title>` creates a task and prints its id'
const LS = '`relkit list` prints one line per open task'
const FIN = '`relkit done <id>` marks the task complete'

function claim(anchor: string, title: string, over: Partial<FlowClaimInput> = {}): FlowClaimInput {
  return { doc: DOC, anchor, title, driver: 'cli', ...over }
}

const CLAIMS: FlowClaimInput[] = [claim(CREATE, ADD), claim(LIST, LS), claim(DONE, FIN)]

const AREA: FlowSynthesisArea = {
  areaId: 'tasks',
  claims: CLAIMS,
  docs: [
    {
      doc: DOC,
      outline: INDEX.sections.map((s) => ({ anchor: s.anchor, headingText: s.headingText, level: s.level })),
    },
  ],
}

const ms = (anchor: string, claimTitle: string, order: number) => ({ doc: DOC, anchor, claimTitle, order })

/** The full lifecycle path — every required claim accounted for. */
const LIFECYCLE: FlowSet = {
  flows: [
    {
      title: 'Create, list and complete a task',
      goal: 'A user adds a task, sees it, and completes it.',
      milestones: [ms(CREATE, ADD, 1), ms(LIST, LS, 2), ms(DONE, FIN, 3)],
    },
  ],
  noFlowClaims: [],
}

const CHECKER: FlowsCheckerContext = { sectionKeys: SECTION_KEYS, catalogNames: new Set<string>() }

function universeOf(r: string): { universe: ReturnType<typeof buildGuardDocUniverse>; docs: GuardDoc[] } {
  const docs = collectWorkDocs(r, planGuardWork(r))
  return { universe: buildGuardDocUniverse(docs), docs }
}

function docRepo(): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, CONTENT)
  return r
}

async function callTool(input: SessionRunInput, name: string, args: unknown): Promise<{ content: string; isError?: boolean }> {
  const tool = input.def.tools.find((t) => t.name === name)!
  const result = await tool.execute(args, {
    workItem: 'area',
    signal: input.signal,
    dispatchChild: () => {
      throw new Error('flow synthesis dispatches no children')
    },
  })
  input.onEvent({ type: 'tool-result', toolName: name, content: result.content, isError: result.isError })
  return result
}

// ---------------------------------------------------------------------------
// The def through the loop
// ---------------------------------------------------------------------------

describe('guard-generate.flows — the area session through the loop', () => {
  it('bounces an unknown milestone from `check_flows`, then accepts the corrected draft', async () => {
    const r = docRepo()
    const { universe } = universeOf(r)
    const dirty: FlowSet = {
      flows: [
        {
          title: 'Invented',
          goal: 'asserts something extraction never produced',
          milestones: [ms(CREATE, '`relkit archive` hides a task from every list', 1)],
        },
      ],
      noFlowClaims: [],
    }
    let first: { content: string; isError?: boolean } | null = null
    let second: { content: string; isError?: boolean } | null = null

    const { driver } = stubDriver(async (call) => {
      first = await callTool(call.input, 'check_flows', dirty)
      second = await callTool(call.input, 'check_flows', LIFECYCLE)
      return outcome(LIFECYCLE)
    })
    const { persistence } = memoryPersistence()
    const settled = await runAgentLoop<FlowSet>({
      def: flowsSessionDef({ area: AREA, universe, checker: CHECKER }),
      workItem: flowsSessionWorkItem(AREA.areaId),
      initialMessages: [flowsSessionBriefing(AREA, undefined)],
      driver,
      persistence,
      sessionId: 'flows-1',
    }).outcome

    expect(first!.isError).toBe(true)
    expect(first!.content).toContain('matched no claim')
    expect(first!.content).toContain('relkit archive')
    expect(second!.isError).toBeUndefined()
    expect(second!.content).toContain('produce it as the outcome')
    expect(settled.status).toBe('completed')
  })

  it('refuses an outcome produced without `check_flows`, exactly once', async () => {
    const r = docRepo()
    const { universe } = universeOf(r)
    const def = flowsSessionDef({ area: AREA, universe, checker: CHECKER })
    expect(def.outcomePrecondition?.tool).toBe('check_flows')

    const stub = stubDriver(async () => outcome(LIFECYCLE))
    const { persistence } = memoryPersistence()
    const settled = await runAgentLoop<FlowSet>({
      def,
      workItem: flowsSessionWorkItem(AREA.areaId),
      initialMessages: [flowsSessionBriefing(AREA, undefined)],
      driver: stub.driver,
      persistence,
      sessionId: 'flows-2',
    }).outcome

    expect(settled.status).toBe('completed')
    expect(stub.calls).toHaveLength(2)
    expect(stub.calls[1].briefing).toBe(def.outcomePrecondition!.message)
  })

  it('the area session reads sections; the epic session has only its checker', async () => {
    const r = docRepo()
    const { universe } = universeOf(r)
    const area = flowsSessionDef({ area: AREA, universe, checker: CHECKER })
    expect(area.tools.map((t) => t.name).sort()).toEqual(['check_flows', 'read_section'])
    expect(area.budget).toEqual({ turns: 12, maxResumes: 1, tokenCeiling: 150_000 })
    expect(FLOWS_SESSION_BUDGET).toEqual(area.budget)
    expect(area.kind).toBe(FLOWS_SESSION_KIND)

    const epic = flowsEpicSessionDef({ digests: [], claims: CLAIMS })
    expect(epic.tools.map((t) => t.name)).toEqual(['check_flows'])
    expect(epic.kind).toBe(FLOWS_SESSION_KIND)
  })

  it('`read_section` opens an area doc by anchor and names the outline when it cannot', async () => {
    const r = docRepo()
    const { universe } = universeOf(r)
    const def = flowsSessionDef({ area: AREA, universe, checker: CHECKER })
    const tool = def.tools.find((t) => t.name === 'read_section')!
    const ctx = { workItem: '', signal: new AbortController().signal, dispatchChild: () => {
      throw new Error('unused')
    } }
    const ok = await tool.execute({ doc: DOC, heading: LIST }, ctx)
    expect(ok.isError).toBeUndefined()
    expect(ok.content).toContain('`relkit list` prints one line per open task')
    const bad = await tool.execute({ doc: DOC, heading: 'nowhere' }, ctx)
    expect(bad.isError).toBe(true)
    expect(bad.content).toContain(CREATE)
    const noDoc = await tool.execute({ doc: 'docs/other.md', heading: LIST }, ctx)
    expect(noDoc.isError).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 1 — checker/fold parity
// ---------------------------------------------------------------------------

describe('checkFlowSet — the tool and the fold agree', () => {
  it('accepts a paraphrased-but-containable milestone (no defect, snapped in the fold)', async () => {
    const paraphrased: FlowSet = {
      flows: [
        {
          title: 'Create and list',
          goal: 'a user adds a task and sees it',
          // Case, whitespace and a trailing period the model added; the second
          // is a unique containment match inside its section.
          milestones: [ms(CREATE, `  ${ADD.toUpperCase()}.  `, 1), ms(LIST, '`relkit list` prints one line', 2)],
        },
      ],
      noFlowClaims: [{ doc: DOC, anchor: DONE, claimTitle: FIN, reason: 'a later path covers it' }],
    }
    const report = checkFlowSet(paraphrased, { area: AREA, ...CHECKER })
    expect(report.unknownReferences).toEqual([])
    expect(report.uncoveredClaims).toEqual([])
    expect(isFlowSetClean(report)).toBe(true)
    expect(flowSetRefusalReason(report)).toBeNull()

    // The fold snaps back to the inventory's canonical text.
    const r = repo()
    const res = await synthesizeFlows({
      repoRoot: r,
      areas: [AREA],
      areaSession: flowsAreaSessionOf(() => paraphrased),
      epicSession: noEpicSessions,
      sectionFingerprints: FINGERPRINTS,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    })
    expect(res.unsettled).toEqual([])
    expect(res.flows[0].milestones.map((m) => m.claimTitle)).toEqual([ADD, LS])
  })

  it('names an unknown milestone, and the fold refuses the same area for it', async () => {
    const dirty: FlowSet = {
      flows: [{ title: 'Invented', goal: 'g', milestones: [ms(CREATE, 'relkit archive hides a task', 1)] }],
      noFlowClaims: [],
    }
    const report = checkFlowSet(dirty, { area: AREA, ...CHECKER })
    expect(report.unknownReferences).toHaveLength(1)
    expect(report.unknownReferences[0]).toContain('relkit archive')
    expect(isFlowSetClean(report)).toBe(false)
    expect(flowSetRefusalReason(report)).toContain('flow synthesis refused: 1 milestone(s) matched no claim')

    const r = repo()
    const res = await synthesizeFlows({
      repoRoot: r,
      areas: [AREA],
      areaSession: flowsAreaSessionOf(() => dirty),
      epicSession: noEpicSessions,
      sectionFingerprints: FINGERPRINTS,
    })
    expect(res.flows).toEqual([])
    expect(res.unsettled[0].areaId).toBe('tasks')
    expect(res.unsettled[0].reason.startsWith('flow synthesis refused:')).toBe(true)
    expect(res.unsettled[0].reason).toContain('matched no claim')
  })

  it('names an unaccounted REQUIRED claim, and the fold refuses for it too', async () => {
    const partial: FlowSet = {
      flows: [{ title: 'Create only', goal: 'g', milestones: [ms(CREATE, ADD, 1)] }],
      noFlowClaims: [],
    }
    const report = checkFlowSet(partial, { area: AREA, ...CHECKER })
    expect(report.uncoveredClaims).toHaveLength(2)
    expect(flowSetRefusalReason(report)).toContain('2 claim(s) left unaccounted')

    const r = repo()
    const res = await synthesizeFlows({
      repoRoot: r,
      areas: [AREA],
      areaSession: flowsAreaSessionOf(() => partial),
      epicSession: noEpicSessions,
      sectionFingerprints: FINGERPRINTS,
    })
    expect(res.unsettled[0].reason).toContain('claim(s) left unaccounted')
  })

  it('does NOT count a non-runnable claim toward coverage', () => {
    const withTui: FlowSynthesisArea = { ...AREA, claims: [...CLAIMS, claim(LIST, 'the board shows one card per task', { driver: 'tui' })] }
    const report = checkFlowSet(LIFECYCLE, { area: withTui, ...CHECKER })
    expect(report.uncoveredClaims).toEqual([])
    expect(isFlowSetClean(report)).toBe(true)
  })

  it('reports unbindable milestones and unbound needs as OBSERVATIONS only', () => {
    const area: FlowSynthesisArea = {
      ...AREA,
      claims: [
        claim(CREATE, ADD, { needs: [{ kind: 'credential', name: 'github-token' }] }),
        claim(LIST, LS),
        claim(DONE, FIN),
      ],
    }
    const report = checkFlowSet(LIFECYCLE, {
      area,
      // The `Creating tasks` section has left the live index.
      sectionKeys: new Set([flowSectionKey(DOC, LIST), flowSectionKey(DOC, DONE)]),
      catalogNames: new Set(['a-project']),
    })
    expect(report.unbindable).toHaveLength(1)
    expect(report.unbindable[0]).toContain(CREATE)
    expect(report.unboundNeeds).toHaveLength(1)
    expect(report.unboundNeeds[0]).toContain('github-token')
    // Neither refuses.
    expect(isFlowSetClean(report)).toBe(true)
    expect(flowSetRefusalReason(report)).toBeNull()
  })

  it('the tool renders refusals as isError and observations as notes', async () => {
    const r = docRepo()
    const { universe } = universeOf(r)
    const def = flowsSessionDef({ area: AREA, universe, checker: CHECKER })
    const tool = def.tools.find((t) => t.name === 'check_flows')!
    const ctx = { workItem: '', signal: new AbortController().signal, dispatchChild: () => {
      throw new Error('unused')
    } }

    const clean = await tool.execute(LIFECYCLE, ctx)
    expect(clean.isError).toBeUndefined()
    expect(clean.content).toContain('The draft is valid')

    // A near-duplicate is a NOTE on an otherwise-clean draft, never a refusal.
    const dup: FlowSet = {
      flows: [
        ...LIFECYCLE.flows,
        { title: 'Create and list', goal: 'g', milestones: [ms(CREATE, ADD, 1), ms(LIST, LS, 2)] },
      ],
      noFlowClaims: [],
    }
    const noted = await tool.execute(dup, ctx)
    expect(noted.isError).toBeUndefined()
    expect(noted.content).toContain('near-duplicate')
    expect(noted.content).toContain('the engine will drop it')

    const bad = await tool.execute(
      { flows: [{ title: 'x', goal: 'g', milestones: [ms(CREATE, 'nothing like a claim here', 1)] }], noFlowClaims: [] },
      ctx,
    )
    expect(bad.isError).toBe(true)
    expect(bad.content).toContain('would refuse the outcome')
  })
})

// ---------------------------------------------------------------------------
// 7 — the epic checker
// ---------------------------------------------------------------------------

const DIGESTS: FlowDigest[] = [
  { ref: 'F1', areaId: 'tasks', title: 'Create a task', goal: 'g', milestones: [{ doc: DOC, anchor: CREATE, claimTitle: ADD }] },
  { ref: 'F2', areaId: 'accounts', title: 'List tasks', goal: 'g', milestones: [{ doc: DOC, anchor: LIST, claimTitle: LS }] },
]

describe('checkEpicSet', () => {
  it('flags a milestone belonging to no composed flow', () => {
    const { unknownReferences } = checkEpicSet(
      {
        epics: [
          {
            title: 'Onboard',
            goal: 'g',
            composedOf: ['F1', 'F2'],
            milestones: [{ doc: DOC, anchor: CREATE, claimTitle: ADD, order: 1 }, { doc: DOC, anchor: DONE, claimTitle: FIN, order: 2 }],
          },
        ],
      },
      DIGESTS,
      CLAIMS,
    )
    expect(unknownReferences).toHaveLength(1)
    expect(unknownReferences[0]).toContain(FIN)
  })

  it('reports the det DROP rules as notes, never refusals', () => {
    const fewRefs = checkEpicSet(
      { epics: [{ title: 'Thin', goal: 'g', composedOf: ['F1'], milestones: [{ doc: DOC, anchor: CREATE, claimTitle: ADD, order: 1 }] }] },
      DIGESTS,
      CLAIMS,
    )
    expect(fewRefs.unknownReferences).toEqual([])
    expect(fewRefs.notes[0]).toContain('fewer than two known flows')

    const fewMilestones = checkEpicSet(
      { epics: [{ title: 'Thin', goal: 'g', composedOf: ['F1', 'F2'], milestones: [{ doc: DOC, anchor: CREATE, claimTitle: ADD, order: 1 }] }] },
      DIGESTS,
      CLAIMS,
    )
    expect(fewMilestones.unknownReferences).toEqual([])
    expect(fewMilestones.notes[0]).toContain('fewer than two snapped milestones')
  })

  it('accepts the empty epic set, and the tool says so', async () => {
    const def = flowsEpicSessionDef({ digests: DIGESTS, claims: CLAIMS })
    const tool = def.tools.find((t) => t.name === 'check_flows')!
    const result = await tool.execute({ epics: [] }, {
      workItem: '',
      signal: new AbortController().signal,
      dispatchChild: () => {
        throw new Error('unused')
      },
    })
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('An empty epic set is a valid answer')
  })
})

// ---------------------------------------------------------------------------
// 8 — the briefings and the keys
// ---------------------------------------------------------------------------

function digestsFor(count: number): FlowsSessionGrounding {
  return {
    interfaces: [
      {
        surface: 'cli',
        digests: Array.from({ length: count }, (_, i) => ({
          id: `cli/cmd-${i}`,
          title: `cmd ${i}`,
          entry: `relkit cmd-${i}`,
          steps: [`invoke: relkit cmd-${i}`],
        })),
      },
    ],
    dependencies: [{ name: 'a-project', class: 'fixture' }],
  }
}

describe('flowsSessionBriefing', () => {
  it('renders the outlines, the closed claim set and the accounting marks', () => {
    const briefing = flowsSessionBriefing(AREA, undefined)
    expect(briefing).toContain('Area: tasks')
    expect(briefing).toContain('DOCUMENT OUTLINES')
    expect(briefing).toContain(`${CREATE} — Creating tasks`)
    expect(briefing).toContain('CLAIMS IN THIS AREA')
    expect(briefing).toContain(`claim: ${ADD}`)
    expect(briefing).toContain('account: required')
    expect(briefing).toContain('Check the draft with `check_flows`')
  })

  it('marks a non-runnable claim optional', () => {
    const area: FlowSynthesisArea = { ...AREA, claims: [claim(LIST, 'the board shows a card', { driver: 'tui' })] }
    expect(flowsSessionBriefing(area, undefined)).toContain('account: optional')
  })

  it('renders a claim’s needs inline', () => {
    const area: FlowSynthesisArea = {
      ...AREA,
      claims: [claim(CREATE, ADD, { needs: [{ kind: 'credential', name: 'github-token' }, { kind: 'fixture', name: 'sample-repo' }] })],
    }
    expect(flowsSessionBriefing(area, undefined)).toContain('needs: credential github-token; fixture sample-repo')
  })

  it('renders the grounding block and caps digests at 40 per surface', () => {
    const briefing = flowsSessionBriefing(AREA, digestsFor(45))
    expect(briefing).toContain('GROUNDING')
    expect(briefing).toContain('[surface cli — 45 interface(s)]')
    expect(briefing).toContain('cli/cmd-0 · cmd 0 · relkit cmd-0')
    expect(briefing).toContain('cli/cmd-39')
    expect(briefing).not.toContain('cli/cmd-40 ·')
    expect(briefing).toContain('… 5 more')
    expect(briefing).toContain('DEPENDENCY CATALOG')
    expect(briefing).toContain('a-project (fixture)')
  })

  it('renders no grounding block at all when there is none', () => {
    expect(flowsSessionBriefing(AREA, undefined)).not.toContain('GROUNDING')
    expect(flowsSessionBriefing(AREA, { interfaces: [{ surface: 'cli', digests: [] }], dependencies: [] })).not.toContain('GROUNDING')
  })

  it('the epic briefing is digests only', () => {
    const briefing = flowsEpicSessionBriefing(DIGESTS)
    expect(briefing).toContain('--- F1  (area: tasks)')
    expect(briefing).toContain('title: Create a task')
    expect(briefing).toContain(`1. ${DOC}#${CREATE} — ${ADD}`)
    expect(briefing).not.toContain('relkit list` prints one line per open task, newest first')
  })
})

describe('the session cache keys', () => {
  // The key-parity property the pre-flight estimate stands on: the key is
  // recomputable from the EXPORTED material alone (prompt fingerprint, area id,
  // claims, outlines) — grounding is deliberately not part of it.
  it('is recomputable from the exported material, and nothing else', () => {
    const sha = (t: string): string => createHash('sha256').update(t).digest('hex')
    const expected = sha(
      `${FLOWS_SESSION_PROMPT_FINGERPRINT}::${AREA.areaId}::${sha(flowAreaClaimsMaterial(AREA))}::${sha(flowAreaOutlinesMaterial(AREA))}`,
    )
    expect(flowsSessionCacheKey(AREA)).toBe(expected)
  })

  it('moves with the area id, the claims and the outlines', () => {
    const base = flowsSessionCacheKey(AREA)
    expect(flowsSessionCacheKey({ ...AREA, areaId: 'other' })).not.toBe(base)
    expect(flowsSessionCacheKey({ ...AREA, claims: CLAIMS.slice(0, 2) })).not.toBe(base)
    expect(flowsSessionCacheKey({ ...AREA, docs: [{ ...AREA.docs[0], outline: AREA.docs[0].outline.slice(1) }] })).not.toBe(base)
  })

  it('moves when a claim gains needs, and not otherwise', () => {
    const base = flowsSessionCacheKey(AREA)
    const withNeeds: FlowSynthesisArea = {
      ...AREA,
      claims: [claim(CREATE, ADD, { needs: [{ kind: 'credential', name: 'github-token' }] }), claim(LIST, LS), claim(DONE, FIN)],
    }
    expect(flowsSessionCacheKey(withNeeds)).not.toBe(base)
    // An EMPTY needs array is the same as none — a one-shot-era inventory keys
    // byte-identically to before needs existed.
    const emptyNeeds: FlowSynthesisArea = { ...AREA, claims: CLAIMS.map((c) => ({ ...c, needs: [] })) }
    expect(flowAreaClaimsMaterial(emptyNeeds)).toBe(flowAreaClaimsMaterial(AREA))
    expect(flowsSessionCacheKey(emptyNeeds)).toBe(base)
  })

  it('the claims material is order-independent and sorted', () => {
    const reversed: FlowSynthesisArea = { ...AREA, claims: [...CLAIMS].reverse() }
    expect(flowAreaClaimsMaterial(reversed)).toBe(flowAreaClaimsMaterial(AREA))
  })

  it('the epic key is a function of the digests', () => {
    const base = flowsEpicSessionCacheKey(DIGESTS)
    expect(base).toMatch(/^[0-9a-f]{64}$/)
    expect(flowsEpicSessionCacheKey([DIGESTS[0]])).not.toBe(base)
    // The area and epic keys never collide (different prompt fingerprints).
    expect(FLOWS_EPIC_SESSION_PROMPT_FINGERPRINT).not.toBe(flowsSessionCacheKey(AREA))
  })

  it('the work items and the cache name are what the plan named', () => {
    expect(flowsSessionWorkItem('tasks')).toBe('area:tasks')
    expect(FLOWS_EPIC_WORK_ITEM).toBe('flows:epic')
    expect(FLOWS_SESSION_CACHE_NAME).toBe('guard/flows')
  })
})

describe('the flows system prompts', () => {
  it('keeps the binding rule: a milestone COPIES a given claim', () => {
    expect(FLOWS_SESSION_SYSTEM_PROMPT).toContain('COPIES one given claim')
    expect(FLOWS_SESSION_SYSTEM_PROMPT).toContain('Never invent, reword, translate, shorten, merge, or split a claim')
    expect(FLOWS_SESSION_SYSTEM_PROMPT).toContain('Milestones still come ONLY from the claims')
  })

  it('states the coverage honesty rule', () => {
    expect(FLOWS_SESSION_SYSTEM_PROMPT).toContain('# Coverage honesty')
    expect(FLOWS_SESSION_SYSTEM_PROMPT).toContain('account: required')
    expect(FLOWS_SESSION_SYSTEM_PROMPT).toContain('noFlowClaims')
    expect(FLOWS_SESSION_SYSTEM_PROMPT).toContain('A ONE-MILESTONE flow is correct')
  })

  it('the epic prompt defaults to none and only chains listed flows', () => {
    expect(FLOWS_EPIC_SESSION_SYSTEM_PROMPT).toContain('The default answer is none')
    expect(FLOWS_EPIC_SESSION_SYSTEM_PROMPT).toContain('at least TWO, from DIFFERENT areas')
    expect(FLOWS_EPIC_SESSION_SYSTEM_PROMPT).toContain('{ "epics": [] }')
  })
})

// ---------------------------------------------------------------------------
// 9 — the procedure gate survives the carve-out
// ---------------------------------------------------------------------------

/** An api interface derived from a tRPC procedure (item 12's exclusion). */
function procedureInterface(): Interface {
  const shape = {
    type: 'api' as const,
    entry: { method: 'GET', path: '/api/trpc/task.list' },
    steps: [{ kind: 'request' as const, method: 'GET', path: '/api/trpc/task.list' }],
  }
  return {
    id: 'api/trpc-task-list',
    title: 'task.list',
    ...shape,
    procedure: { router: 'task', name: 'list', kind: 'query' as const },
    fingerprint: interfaceFingerprint(shape),
  }
}

function plainApiInterface(): Interface {
  const shape = {
    type: 'api' as const,
    entry: { method: 'GET', path: '/todos' },
    steps: [{ kind: 'request' as const, method: 'GET', path: '/todos' }],
  }
  return { id: 'api/get-todos', title: 'GET /todos', ...shape, fingerprint: interfaceFingerprint(shape) }
}

describe('the procedure gate', () => {
  it('keeps tRPC-derived operations out of the synthesis briefing’s grounding', async () => {
    const r = docRepo()
    let grounding: FlowsSessionGrounding | undefined
    const res = await generateGuards({
      repoRoot: r,
      stopAfterFlows: true,
      interfaces: interfacesOf(r, plainApiInterface(), procedureInterface()),
      extractSession: extractSessionBy({}),
      flowsAreaSession: async (input) => {
        grounding = input.grounding
        return flowsAreaSessionOf(() => ({ flows: [], noFlowClaims: [] }))(input)
      },
      flowsEpicSession: noEpicSessions,
      flowWorkerSession: noWorkerSessions,
    })
    expect(res.status).not.toBe('recipe-failed')

    const api = grounding!.interfaces.find((s) => s.surface === 'api')!
    expect(api.digests.map((d) => d.id)).toEqual(['api/get-todos'])
    expect(JSON.stringify(grounding)).not.toContain('trpc')
  })

  it('hands the run’s docs to the seam so `read_section` has a universe', async () => {
    const r = docRepo()
    let docs: readonly GuardDoc[] | undefined
    await generateGuards({
      repoRoot: r,
      stopAfterFlows: true,
      interfaces: DEFAULT_INTERFACES(r),
      extractSession: extractSessionBy({}),
      flowsAreaSession: async (input) => {
        docs = input.docs
        return flowsAreaSessionOf(() => ({ flows: [], noFlowClaims: [] }))(input)
      },
      flowsEpicSession: noEpicSessions,
      flowWorkerSession: noWorkerSessions,
    })
    expect(docs?.map((d) => d.doc)).toEqual([DOC])
  })
})

// ---------------------------------------------------------------------------
// 3 + 5 — the wipeout guard, from the flows side
// ---------------------------------------------------------------------------

describe('the flow-synthesis wipeout', () => {
  it('never rewrites flows.json when every area refused, and aborts the run', async () => {
    const r = docRepo()
    // A committed corpus a wipeout must not clobber.
    const flowsFile = path.join(r, '.truecourse', 'scenarios', 'flows.json')
    fs.mkdirSync(path.dirname(flowsFile), { recursive: true })
    const committed = JSON.stringify({ version: 1, generatedAt: '2026-01-01T00:00:00.000Z', flows: [], noFlowClaims: [] }, null, 2)
    fs.writeFileSync(flowsFile, committed)

    const res = await generateGuards({
      repoRoot: r,
      interfaces: DEFAULT_INTERFACES(r),
      extractSession: extractSessionBy({}),
      // Every area answers with a draft the fold refuses.
      flowsAreaSession: flowsAreaSessionOf(() => ({
        flows: [{ title: 'Invented', goal: 'g', milestones: [{ doc: DOC, anchor: CREATE, claimTitle: 'nothing like a claim', order: 1 }] }],
        noFlowClaims: [],
      })),
      flowsEpicSession: noEpicSessions,
      flowWorkerSession: noWorkerSessions,
    })

    expect(res.status).toBe('llm-failed')
    expect(res.reason).toBeTruthy()
    expect(fs.readFileSync(flowsFile, 'utf-8')).toBe(committed)
  })
})
