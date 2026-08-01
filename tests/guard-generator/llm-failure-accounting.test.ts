/**
 * Total-vs-partial LLM failure accounting in generateGuards(). A stage whose every
 * call failed used to report `status: 'ok'` with `written: []` and an empty
 * manifest — a run that verified nothing, indistinguishable from a clean no-op.
 * Now: extraction (and authoring) losing EVERY call returns `llm-failed` and
 * rewrites nothing on disk — whether the calls threw or answered with output that
 * failed validation twice; losing SOME keeps the fail-soft behavior and reports the
 * counts; a run whose stages never reach the transport is healthy.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import { generateGuards, type GenerateRunner } from '@truecourse/guard-generator'
import { manifestPath, readManifest, writeManifest, scenariosDir } from '@truecourse/guard-runner'
import { GUARD_FORMAT_VERSION, type GuardScenario } from '@truecourse/shared'
import type { LlmTransport } from '@truecourse/shared/llm'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  writeScenarioFile,
  bindsFor,
  raw,
  extractBy,
  authorBy,
  authored,
  faithfulReviewer,
  stubAuxRunners,
  PASSING_STEPS,
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

const DOC = 'docs/cli.md'
const DOC_CONTENT = ['## version', '`relkit --version` prints the version and exits 0.'].join('\n')
const OTHER_DOC = 'docs/other.md'
const OTHER_CONTENT = ['## help', '`relkit --version` also answers here and exits 0.'].join('\n')

/** A valid one-claim extraction for a section anchor. */
function extraction(anchor: string): string {
  return JSON.stringify({
    claims: [{ claim: `${anchor} works`, driver: 'cli', sectionAnchor: anchor, reason: 'exit code is observable' }],
    untestable: [],
  })
}

/** A transport that throws for `stages` and otherwise answers via `answer`. */
function transport(stages: string[], message: string, answer: (req: { id?: string }) => string = () => '{}'): LlmTransport {
  return async (req) => {
    if (stages.includes(req.stage ?? '')) throw new Error(message)
    return answer(req)
  }
}

describe('generateGuards — extraction losing every call aborts the run', () => {
  it('returns llm-failed with the stage reason and the affected documents, writing no manifest', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      transport: transport(['guard.extract'], "Invalid schema for response_format 'response': Missing 'extension'."),
      generateRunner: authorBy({}),
    })

    expect(res.status).toBe('llm-failed')
    expect(res.reason).toContain('guard.extract')
    expect(res.reason).toContain("Missing 'extension'")
    expect(res.written).toEqual([])
    // The affected document is named, not just counted.
    expect(res.extractionFailures.map((f) => f.doc)).toEqual([DOC])
    expect(res.llmFailures).toEqual([
      {
        stage: 'guard.extract',
        attempts: 1,
        failures: 1,
        firstError: "Invalid schema for response_format 'response': Missing 'extension'.",
      },
    ])
    // A healthy-looking empty manifest is exactly what made this invisible.
    expect(fs.existsSync(manifestPath(r))).toBe(false)
  })

  it('leaves a prior manifest and the scenarios it binds untouched', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)
    const binds = bindsFor(r, DOC, 'version')
    const scenario: GuardScenario = {
      guard: GUARD_FORMAT_VERSION,
      id: 'version.1',
      title: 'prints the version',
      driver: 'cli',
      binds,
      steps: PASSING_STEPS,
    }
    writeScenarioFile(r, 'cli/version.1.yaml', scenario)
    writeManifest(r, {
      guard: GUARD_FORMAT_VERSION,
      // A null generationInputsHash re-detects the section as work, so this run
      // really does re-attempt it (and would sweep it away on a zero-survivor run).
      sections: [{ doc: DOC, anchor: 'version', fingerprint: binds.fingerprint, scenarioIds: ['version.1'], generationInputsHash: null }],
    })
    const priorManifest = fs.readFileSync(manifestPath(r), 'utf-8')
    const priorScenario = fs.readFileSync(`${scenariosDir(r)}/cli/version.1.yaml`, 'utf-8')

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      transport: transport(['guard.extract'], 'claude exited 1'),
      generateRunner: authorBy({}),
    })

    expect(res.status).toBe('llm-failed')
    expect(fs.readFileSync(manifestPath(r), 'utf-8')).toBe(priorManifest)
    expect(fs.readFileSync(`${scenariosDir(r)}/cli/version.1.yaml`, 'utf-8')).toBe(priorScenario)
  })
})

describe('generateGuards — authoring losing every call aborts before the sweep', () => {
  it('returns llm-failed and keeps the prior scenarios the zero-survivor sweep would delete', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)
    const binds = bindsFor(r, DOC, 'version')
    writeScenarioFile(r, 'cli/version.1.yaml', {
      guard: GUARD_FORMAT_VERSION,
      id: 'version.1',
      title: 'prints the version',
      driver: 'cli',
      binds,
      steps: PASSING_STEPS,
    })
    writeManifest(r, {
      guard: GUARD_FORMAT_VERSION,
      sections: [{ doc: DOC, anchor: 'version', fingerprint: binds.fingerprint, scenarioIds: ['version.1'], generationInputsHash: null }],
    })

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractBy({}),
      transport: transport(['guard.generate'], 'claude exited 1: expired login'),
    })

    expect(res.status).toBe('llm-failed')
    expect(res.reason).toContain('guard.generate')
    expect(res.written).toEqual([])
    expect(res.llmFailures.find((f) => f.stage === 'guard.generate')?.failures).toBeGreaterThan(0)
    // The section's prior scenario survives — an LLM outage never deletes coverage.
    expect(fs.existsSync(`${scenariosDir(r)}/cli/version.1.yaml`)).toBe(true)
    expect(readManifest(r)!.sections.map((s) => s.anchor)).toEqual(['version'])
  })
})

describe('generateGuards — authoring answering with unusable output aborts too', () => {
  // The calls SUCCEED at the transport and come back shaped wrong (what JSON mode
  // produces for a contract the model missed), so the stage tally counts no failures
  // — the run must still refuse to report success.
  it('returns llm-failed with no transport failures, keeping the prior scenarios', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)
    const binds = bindsFor(r, DOC, 'version')
    writeScenarioFile(r, 'cli/version.1.yaml', {
      guard: GUARD_FORMAT_VERSION,
      id: 'version.1',
      title: 'prints the version',
      driver: 'cli',
      binds,
      steps: PASSING_STEPS,
    })
    writeManifest(r, {
      guard: GUARD_FORMAT_VERSION,
      sections: [{ doc: DOC, anchor: 'version', fingerprint: binds.fingerprint, scenarioIds: ['version.1'], generationInputsHash: null }],
    })

    // Every authoring reply is a JSON object that is not the batch envelope.
    const answering: LlmTransport = async (req) => {
      if (req.stage === 'guard.extract') return extraction('version')
      if (req.stage === 'guard.generate') return '{"scenarios":[]}'
      return '{}'
    }

    const res = await generateGuards({ ...stubAuxRunners(), repoRoot: r, transport: answering })

    expect(res.status).toBe('llm-failed')
    expect(res.reason).toContain('guard.generate')
    expect(res.reason).toContain('unusable')
    expect(res.written).toEqual([])
    // The calls answered, so nothing is a transport failure — the reason is the record.
    expect(res.llmFailures.find((f) => f.stage === 'guard.generate')).toBeUndefined()
    expect(res.errors.map((e) => e.anchor)).toEqual(['version'])
    // The section's prior scenario + manifest entry survive the aborted run.
    expect(fs.existsSync(`${scenariosDir(r)}/cli/version.1.yaml`)).toBe(true)
    expect(readManifest(r)!.sections.map((s) => s.anchor)).toEqual(['version'])
  })

  it('one document of two authoring unusably is NOT fatal — the other is written', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }, { ref: OTHER_DOC }])
    writeDoc(r, DOC, DOC_CONTENT)
    writeDoc(r, OTHER_DOC, OTHER_CONTENT)

    const halfBad: GenerateRunner = async ({ doc, claims }) =>
      doc === OTHER_DOC
        ? { scenarios: [] }
        : authored(claims.map((c) => ({ ref: c.ref, scenarios: [raw('relkit --version exits 0', PASSING_STEPS)] })))

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractBy({}),
      generateRunner: halfBad,
      fidelityRunner: faithfulReviewer(),
    })

    expect(res.status).toBe('ok')
    expect(res.written.map((w) => w.anchor)).toEqual(['version'])
    expect(res.errors.map((e) => e.anchor)).toEqual(['help'])
  })
})

describe('generateGuards — isolated failures stay fail-soft but are reported', () => {
  it('one document of two failed extraction: the other is generated and the failure is named', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }, { ref: OTHER_DOC }])
    writeDoc(r, DOC, DOC_CONTENT)
    writeDoc(r, OTHER_DOC, OTHER_CONTENT)

    // `docs/other.md` extraction fails; `docs/cli.md` answers.
    const failing: LlmTransport = async (req) => {
      if (req.stage !== 'guard.extract') return '{}'
      if (req.id?.includes(OTHER_DOC)) throw new Error('claude API error (api 500)')
      return extraction('version')
    }

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      transport: failing,
      generateRunner: authorBy({ version: [raw('relkit --version exits 0', PASSING_STEPS)] }),
      fidelityRunner: faithfulReviewer(),
    })

    expect(res.status).toBe('ok')
    expect(res.written.map((w) => w.anchor)).toEqual(['version'])
    expect(res.extractionFailures.map((f) => f.doc)).toEqual([OTHER_DOC])
    expect(res.llmFailures).toEqual([
      { stage: 'guard.extract', attempts: 2, failures: 1, firstError: 'claude API error (api 500)' },
    ])
  })

  it('a run whose stages never reach the transport reports no failures', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractBy({}),
      generateRunner: authorBy({ version: [raw('relkit --version exits 0', PASSING_STEPS)] }),
      fidelityRunner: faithfulReviewer(),
    })

    expect(res.status).toBe('ok')
    expect(res.llmFailures).toEqual([])
  })
})
