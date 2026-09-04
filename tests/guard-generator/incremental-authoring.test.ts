/**
 * Incremental authoring: a flow whose bound section moved (same milestone
 * composition) is briefed with its COMMITTED scenarios and edits them —
 * `submit_scenario` with `replaces` keeps an id, an omitted `replaces` adds a
 * scenario, `drop_scenario` retires one with a reason — instead of re-sampling
 * from scratch. Taint, `--from-scratch`, and a changed composition still author
 * from scratch; a worker that blocks leaves the prior coverage in place.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { workerCacheKey } from '@truecourse/guard-generator'
import { readManifest } from '@truecourse/guard-runner'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractSessionBy,
  runGenerate,
  submitWorkerSessions,
  PASSING_STEPS,
  type WorkerSpec,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

const DOC = 'docs/cli.md'
const DOC_CONTENT = [
  '## version',
  '`relkit --version` prints the version and exits 0.',
  '',
  '## background',
  'The history of relkit; nothing externally observable here.',
].join('\n')
/** A real obligation change in the bound section — the flow must re-author. */
const EDITED = DOC_CONTENT.replace('prints the version and exits 0.', 'prints the SEMVER version and exits 0.')

const extraction = () => extractSessionBy({ background: { untestable: 'design history, nothing observable' } })
const ORIGINAL = raw('relkit --version prints the version', PASSING_STEPS)
const REVISED = raw('relkit --version prints the semver version', PASSING_STEPS)
const EXTRA = raw('relkit --version prints the semver version (extra check)', PASSING_STEPS)

function seed(): string {
  const r = makeTempRepo()
  repos.push(r)
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
  writeDoc(r, DOC, DOC_CONTENT)
  return r
}

async function generate(
  r: string,
  spec: WorkerSpec | ((priorIds: string[]) => WorkerSpec),
  opts: { briefings?: string[]; reports?: { content: string; isError?: boolean }[]; fromScratch?: boolean } = {},
) {
  return runGenerate({
    repoRoot: r,
    extractSession: extraction(),
    ...(opts.fromScratch ? { fromScratch: true } : {}),
    flowWorkerSession: submitWorkerSessions(
      (task) => (typeof spec === 'function' ? spec(task.prior?.scenarios.map((s) => s.id) ?? []) : spec),
      {
        onBriefing: (_task, briefing) => opts.briefings?.push(briefing),
        onSubmit: (_task, report) => opts.reports?.push(report),
      },
    ),
  })
}

/** First generate: one flow, one committed scenario; returns its id and file. */
async function committed(r: string): Promise<{ id: string; file: string; bytes: string }> {
  const first = await generate(r, ORIGINAL)
  expect(first.status).toBe('ok')
  expect(first.written.length).toBe(1)
  const { id, file } = first.written[0]!
  return { id, file: path.join(r, file), bytes: fs.readFileSync(path.join(r, file), 'utf-8') }
}

describe('incremental authoring — editing committed scenarios', () => {
  it('briefs the worker with its prior scenario and the moved section, and never with PRIOR FLAG', async () => {
    const r = seed()
    const prior = await committed(r)
    writeDoc(r, DOC, EDITED)

    const briefings: string[] = []
    const res = await generate(r, (ids) => ({ edit: [{ replaces: ids[0]!, scenario: ORIGINAL }] }), { briefings })
    expect(res.status).toBe('ok')
    expect(briefings.length).toBe(1)
    expect(briefings[0]).toContain('PRIOR SCENARIOS')
    expect(briefings[0]).toContain(`--- prior scenario ${prior.id}`)
    expect(briefings[0]).toContain(prior.bytes.trim())
    expect(briefings[0]).toContain('#version')
    expect(briefings[0]).not.toContain('PRIOR FLAG')
  }, 90_000)

  it('a kept-verbatim edit lands on the same id and the same steps, and the flow settles', async () => {
    const r = seed()
    const prior = await committed(r)
    writeDoc(r, DOC, EDITED)

    const res = await generate(r, (ids) => ({ edit: [{ replaces: ids[0]!, scenario: ORIGINAL }] }))
    expect(res.status).toBe('ok')
    expect(res.written.map((w) => w.id)).toEqual([prior.id])
    // Byte-identical except the bind's section fingerprint, which the engine
    // re-stamps to the text the scenario now stands against.
    const sansBinds = (yaml: string) => yaml.replace(/^\s*fingerprint: sha256:[0-9a-f]+$/gm, '')
    expect(sansBinds(fs.readFileSync(prior.file, 'utf-8'))).toBe(sansBinds(prior.bytes))
    expect(fs.readFileSync(prior.file, 'utf-8')).not.toBe(prior.bytes)
    const flow = readManifest(r)!.flows[0]!
    expect(flow.generationInputsHash).toMatch(/^sha256:/)
    expect(flow.scenarios.map((s) => s.id)).toEqual([prior.id])
    expect(flow.retiredScenarios).toEqual([])
  }, 90_000)

  it('an edited scenario keeps its id with new bytes', async () => {
    const r = seed()
    const prior = await committed(r)
    writeDoc(r, DOC, EDITED)

    const res = await generate(r, (ids) => ({ edit: [{ replaces: ids[0]!, scenario: REVISED }] }))
    expect(res.status).toBe('ok')
    expect(res.written.map((w) => w.id)).toEqual([prior.id])
    const bytes = fs.readFileSync(prior.file, 'utf-8')
    expect(bytes).not.toBe(prior.bytes)
    expect(bytes).toContain('semver')
  }, 90_000)

  it('an added scenario takes the next id beside the kept one, and both commit', async () => {
    const r = seed()
    const prior = await committed(r)
    writeDoc(r, DOC, EDITED)

    const res = await generate(r, (ids) => ({ edit: [{ replaces: ids[0]!, scenario: ORIGINAL }], add: [EXTRA] }))
    expect(res.status).toBe('ok')
    expect(res.written.map((w) => w.id).sort()).toEqual([prior.id, `${prior.id}.2`])
    const flow = readManifest(r)!.flows[0]!
    expect(flow.scenarios.map((s) => s.id)).toEqual([prior.id, `${prior.id}.2`])
    expect(flow.generationInputsHash).toMatch(/^sha256:/)
    expect(fs.existsSync(prior.file)).toBe(true)
  }, 90_000)

  it('a dropped scenario is deleted, retired with its reason, and the flow still settles', async () => {
    const r = seed()
    const prior = await committed(r)
    writeDoc(r, DOC, EDITED)

    const res = await generate(r, (ids) => ({
      edit: [],
      add: [REVISED],
      drop: [{ id: ids[0]!, reason: 'the plain-version wording is gone; the doc now promises semver' }],
    }))
    expect(res.status).toBe('ok')
    expect(fs.existsSync(prior.file)).toBe(false)
    const flow = readManifest(r)!.flows[0]!
    expect(flow.generationInputsHash).toMatch(/^sha256:/)
    expect(flow.retiredScenarios).toEqual([
      {
        id: prior.id,
        surface: 'cli',
        reason: 'the plain-version wording is gone; the doc now promises semver',
        replacedBy: [`${prior.id}.2`],
      },
    ])
    expect(flow.scenarios.map((s) => s.id)).toEqual([`${prior.id}.2`])
    expect(res.retiredScenarios).toEqual([{ flowId: flow.flowId, ...flow.retiredScenarios[0] }])
  }, 90_000)

  it('a drop of an id the briefing did not carry is refused in-loop', async () => {
    const r = seed()
    await committed(r)
    writeDoc(r, DOC, EDITED)

    const reports: { content: string; isError?: boolean }[] = []
    const res = await generate(
      r,
      (ids) => ({ edit: [{ replaces: ids[0]!, scenario: ORIGINAL }], drop: [{ id: 'nope', reason: 'gone' }] }),
      { reports },
    )
    expect(res.status).toBe('ok')
    const refusal = reports.find((rep) => rep.isError)
    expect(refusal?.content).toContain('"nope" is not a prior scenario')
  }, 90_000)

  it('a blocked worker keeps the prior scenario as coverage beside its gap instead of erasing it', async () => {
    const r = seed()
    const prior = await committed(r)
    writeDoc(r, DOC, EDITED)

    const res = await generate(r, { blocked: [{ order: 1, capability: 'a mail sink' }] })
    expect(res.status).toBe('ok')
    // The file is untouched (its stale bind is what `guard run` surfaces), the
    // manifest still lists it, and the block settles honestly as a gap — the
    // pre-edit-mode outcome minus the deletion.
    expect(fs.existsSync(prior.file)).toBe(true)
    expect(fs.readFileSync(prior.file, 'utf-8')).toBe(prior.bytes)
    expect(res.written).toEqual([])
    const flow = readManifest(r)!.flows[0]!
    expect(flow.scenarios.map((s) => s.id)).toEqual([prior.id])
    expect(flow.gaps.some((g) => g.kind === 'blocked-on')).toBe(true)
    expect(flow.retiredScenarios).toEqual([])
  }, 90_000)

  it('a failed worker session leaves the prior scenario in place and the flow unsettled', async () => {
    const r = seed()
    const prior = await committed(r)
    writeDoc(r, DOC, EDITED)

    // An edit spec that drops an unknown id makes the stub report a FAILED
    // session — the errored-task path, where nothing settles.
    const res = await generate(r, (ids) => ({ edit: [{ replaces: ids[0]!, scenario: ORIGINAL }], drop: [{ id: 'nope', reason: 'gone' }] }))
    expect(res.status).toBe('ok')
    expect(fs.existsSync(prior.file)).toBe(true)
    const flow = readManifest(r)!.flows[0]!
    expect(flow.scenarios.map((s) => s.id)).toEqual([prior.id])
    expect(flow.generationInputsHash).toBeNull()
  }, 90_000)

  it('`fromScratch` authors without briefing the prior, on the same id', async () => {
    const r = seed()
    const prior = await committed(r)
    writeDoc(r, DOC, EDITED)

    const briefings: string[] = []
    const res = await generate(r, REVISED, { briefings, fromScratch: true })
    expect(res.status).toBe('ok')
    expect(briefings[0]).not.toContain('PRIOR SCENARIOS')
    expect(res.written.map((w) => w.id)).toEqual([prior.id])
  }, 90_000)

  it('`replaces` outside edit mode is refused', async () => {
    const r = seed()
    const reports: { content: string; isError?: boolean }[] = []
    const res = await generate(r, { edit: [{ replaces: 'anything', scenario: ORIGINAL }] }, { reports })
    expect(res.status).toBe('ok')
    expect(reports.some((rep) => rep.isError && rep.content.includes('has none to edit'))).toBe(true)
    expect(res.written).toEqual([])
  }, 90_000)

  it('the worker cache key moves with the briefed priors in edit mode and not otherwise', () => {
    const base = ['pf', { fingerprint: 'flow' }, 'cli', ['s1'], ['i1'], 'recipe'] as const
    const scratch = workerCacheKey(...base)
    expect(workerCacheKey(...base, undefined)).toBe(scratch)
    const edit = workerCacheKey(...base, { priorShas: ['a'] })
    expect(edit).not.toBe(scratch)
    expect(workerCacheKey(...base, { priorShas: ['b'] })).not.toBe(edit)
    expect(workerCacheKey(...base, { priorShas: ['b', 'a'] })).toBe(workerCacheKey(...base, { priorShas: ['a', 'b'] }))
  })
})
