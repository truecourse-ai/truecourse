/**
 * The HTTP transport gate: the api surface is a candidate only for a flow whose own
 * spec names HTTP. A request/response contract over stdin/stdout is a real contract,
 * but no `api` recipe block could ever describe it — so it must never be paired with
 * the api surface, and must never ask for a recipe edit that cannot help it.
 *
 * The field case is the Roslyn host's `## Protocol` section: newline-delimited JSON
 * over stdio, whose claims read "an analyze-project request produces `{"ok":false…}`
 * on stdout". Its cli realization (the CLI that spawns the host) is the surface that
 * can actually drive it, and that entry has to survive untouched.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { flowHttpSignal, NO_HTTP_SIGNAL_REASON, type SectionInput } from '@truecourse/guard-generator'
import { readManifest } from '@truecourse/guard-runner'
import type { Journey } from '@truecourse/shared'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeApiRecipe,
  writeDoc,
  writeCorpus,
  extractBy,
  authorBy,
  runGenerate,
  journeysOf,
  cliJourney,
  apiJourney,
  raw,
  rawApi,
  PASSING_STEPS,
  PASSING_API_STEPS,
} from './helpers.js'

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
// The signal itself
// ---------------------------------------------------------------------------

function section(text: string, doc = 'docs/host.md'): SectionInput {
  return {
    doc,
    anchor: 'protocol',
    fingerprint: 'sha256:section',
    headingText: 'Protocol',
    level: 2,
    ownText: text,
    fullText: text,
    areaTags: [],
    suppressionFingerprint: '',
    endpointSchemaFingerprint: '',
    securityFingerprint: '',
  }
}

function flowOver(claim: string, goal = 'verify the protocol'): Parameters<typeof flowHttpSignal>[0]['flow'] {
  return { title: 'a flow', goal, milestones: [{ order: 1, doc: 'docs/host.md', anchor: 'protocol', claimTitle: claim }] }
}

const TODOS_JOURNEY: Journey[] = [apiJourney('GET', '/todos/{id}')]

function signalOf(claim: string, text: string, apiJourneys: Journey[] = TODOS_JOURNEY) {
  return flowHttpSignal({ flow: flowOver(claim), sections: [section(text)], basePaths: new Map(), apiJourneys })
}

describe('flowHttpSignal — the HTTP concretes that earn the api surface', () => {
  it.each([
    ['a method + path in prose', 'a user lists todos', 'GET /todos returns the list.', 'documented-path'],
    ['a curl invocation', 'a user lists todos', 'Run `curl https://api.example.com/todos`.', 'documented-path'],
    ['a stated status code', 'a user lists todos', 'An unknown id responds with 404.', 'status-code'],
    ['a status + reason phrase', 'a user lists todos', 'Unknown ids yield 404 Not Found.', 'status-code'],
    ['a named header', 'a user lists todos', 'Send the Authorization header with a bearer token.', 'header'],
    ['a header line', 'a user lists todos', 'Content-Type: application/json is required.', 'header'],
    ['the protocol itself', 'a user lists todos', 'The service speaks HTTP on port 3000.', 'protocol'],
    ['a loopback URL', 'a user lists todos', 'Open http://localhost:3000/ to see it.', 'protocol'],
    ['a route the repo serves', 'a user lists todos', 'The /todos endpoint lists everything.', 'served-route'],
    ['a route named in the CLAIM', 'the /todos collection is paginated', 'Nothing concrete here.', 'served-route'],
  ])('%s', (_name, claim, text, kind) => {
    expect(signalOf(claim, text)?.kind).toBe(kind)
  })

  it('reads a documented path off an OpenAPI operation section', () => {
    const op = section(['# GET /todos', 'summary: list todos'].join('\n'), 'api/openapi.yaml')
    const signal = flowHttpSignal({
      flow: flowOver('lists todos'),
      sections: [{ ...op, headingText: 'GET /todos' }],
      basePaths: new Map([['api/openapi.yaml', '/v1']]),
      apiJourneys: [],
    })
    expect(signal?.kind).toBe('documented-path')
  })

  it.each([
    ['a stdio JSON protocol', 'an analyze request produces a response on stdout', 'One JSON request per line in, one JSON response per line out.'],
    ['a cli behavior', '`relkit --version` prints the version and exits 0', 'The CLI prints its version.'],
    ['prose about restoring a project', 'the host reports an unrestored project', 'Requires a restored, buildable project.'],
  ])('finds nothing in %s', (_name, claim, text) => {
    expect(signalOf(claim, text)).toBeNull()
  })

  it('finds nothing in the field case — the Roslyn host README, whole', () => {
    const readme = fs.readFileSync(
      fileURLToPath(new URL('../../tools/csharp-roslyn-host/README.md', import.meta.url)),
      'utf-8',
    )
    const flow = {
      title: 'analyze-project reports errors without crashing the host',
      goal: 'an analyze-project request on an unrestored project answers with an error and the host stays alive',
      milestones: [
        {
          order: 1,
          doc: 'tools/csharp-roslyn-host/README.md',
          anchor: 'protocol',
          claimTitle: 'an analyze-project request produces {"ok":false,"error":"..."} on stdout',
        },
      ],
    }
    const signal = flowHttpSignal({
      flow,
      sections: [section(readme, 'tools/csharp-roslyn-host/README.md')],
      basePaths: new Map(),
      // The repo's OWN api journeys are in the catalog — none of their routes is named.
      apiJourneys: [apiJourney('GET', '/api/analyses'), apiJourney('POST', '/api/guard/runs')],
    })
    expect(signal).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The gate, end to end
// ---------------------------------------------------------------------------

const HOST_DOC = 'docs/host.md'
const HOST_DOC_CONTENT = [
  '## protocol',
  'One JSON request per line in, one JSON response per line out. An `analyze-project`',
  'request on an unrestored project produces `{"ok":false,"error":"..."}` on stdout and',
  'the worker stays alive.',
].join('\n')

const API_DOC = 'docs/api.md'
const API_DOC_CONTENT = ['## list', 'GET /todos returns 200 with the todo list.'].join('\n')

describe('generateGuards — a stdio protocol never reaches the api surface', () => {
  it('the field case: no api candidate, no api gap, and the cli surface still accounts for the flow', async () => {
    const r = repo()
    writeRecipe(r) // a cli entry; NO api block — the unsatisfiable ask's precondition
    writeCorpus(r, [{ ref: HOST_DOC }])
    writeDoc(r, HOST_DOC, HOST_DOC_CONTENT)

    const matched: string[] = []
    const res = await runGenerate({
      repoRoot: r,
      // The repo DOES serve HTTP — its api journeys are mapped and would otherwise
      // make every flow ask for a recipe `api` block.
      journeys: journeysOf(r, cliJourney(['relkit']), apiJourney('GET', '/todos')),
      extractRunner: extractBy({
        protocol: [{ driver: 'cli', claim: 'an analyze-project request produces {"ok":false,...} on stdout' }],
      }),
      matchRunner: async ({ flow, milestones, journeys, surface }) => {
        matched.push(`${flow.id}/${surface}`)
        return { plan: milestones.map((m) => ({ journeyId: journeys[0].id, milestone: m.order })) }
      },
      generateRunner: authorBy({ protocol: raw('the host answers an analyze-project request', PASSING_STEPS) }),
    })

    expect(res.status).toBe('ok')
    // The api surface was never a candidate: no match call, no gap, no manifest entry.
    expect(matched).toEqual(['protocol/cli'])
    expect(res.coverageGaps.filter((g) => g.surface === 'api')).toEqual([])
    expect(res.coverageGaps.some((g) => g.reason.includes('a recipe `api` block'))).toBe(false)
    const entry = readManifest(r)!.flows.find((f) => f.flowId === 'protocol')!
    expect(entry.gaps).toEqual([])
    expect(entry.journeys.map((j) => j.surface)).toEqual(['cli'])
    // The cli realization — the surface that can actually drive the protocol — stands.
    expect(res.written.map((w) => w.surface)).toEqual(['cli'])
    expect(entry.scenarios).toEqual([{ id: 'protocol.cli.1', surface: 'cli', status: 'passing' }])
  }, 60_000)

  it('a flow whose spec names HTTP still asks for the api recipe block (the legitimate ask)', async () => {
    const r = repo()
    writeRecipe(r) // same recipe, same missing api block
    writeCorpus(r, [{ ref: API_DOC }])
    writeDoc(r, API_DOC, API_DOC_CONTENT)

    const res = await runGenerate({
      repoRoot: r,
      journeys: journeysOf(r, cliJourney(['relkit']), apiJourney('GET', '/todos')),
      extractRunner: extractBy({ list: [{ driver: 'cli', claim: 'GET /todos returns 200 with the todo list' }] }),
      generateRunner: authorBy({ list: raw('the list endpoint answers', PASSING_STEPS) }),
    })

    const gap = res.coverageGaps.find((g) => g.surface === 'api')!
    expect(gap.kind).toBe('blocked-on')
    expect(gap.reason).toContain('a recipe `api` block')
    expect(gap.flowId).toBe('list')
  }, 60_000)

  it('a route-rooted flow matches the api surface on the route alone — no method, no status', async () => {
    const r = repo()
    writeApiRecipe(r, { entry: null }) // api is the only prepared surface
    writeCorpus(r, [{ ref: 'docs/todos.md' }])
    writeDoc(r, 'docs/todos.md', ['## list', 'The /todos endpoint lists every todo a user owns.'].join('\n'))

    const res = await runGenerate({
      repoRoot: r,
      journeys: journeysOf(r, apiJourney('GET', '/todos')),
      extractRunner: extractBy({ list: [{ driver: 'api', claim: 'the /todos endpoint lists every todo' }] }),
      generateRunner: authorBy({ list: rawApi('the todos endpoint lists todos', PASSING_API_STEPS) }),
    })

    expect(res.status).toBe('ok')
    expect(res.errors).toEqual([])
    expect(res.written.map((w) => w.surface)).toEqual(['api'])
    expect(res.coverageGaps.filter((g) => g.flowId === 'list')).toEqual([])
  }, 60_000)

  it('a flow the gate leaves with NO candidate settles as unrealizable, never in silence', async () => {
    const r = repo()
    writeApiRecipe(r, { entry: null }) // the api surface is the only one there is
    writeCorpus(r, [{ ref: 'docs/booking.md' }])
    writeDoc(r, 'docs/booking.md', ['## booking', 'A user can book a room and receives a confirmation.'].join('\n'))

    const res = await runGenerate({
      repoRoot: r,
      journeys: journeysOf(r, apiJourney('GET', '/todos')),
      extractRunner: extractBy({ booking: [{ driver: 'api', claim: 'a user books a room and is confirmed' }] }),
      matchRunner: async () => {
        throw new Error('matching must never run for a flow with no HTTP signal')
      },
      generateRunner: authorBy({}),
    })

    expect(res.status).toBe('ok')
    expect(res.written).toEqual([])
    const gap = res.coverageGaps.find((g) => g.flowId === 'booking')!
    expect(gap.kind).toBe('unrealizable')
    expect(gap.surface).toBe('api')
    expect(gap.reason).toBe(NO_HTTP_SIGNAL_REASON)
    expect(readManifest(r)!.flows.find((f) => f.flowId === 'booking')!.gaps).toEqual([
      { surface: 'api', kind: 'unrealizable', reason: NO_HTTP_SIGNAL_REASON },
    ])
  }, 60_000)
})
