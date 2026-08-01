import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  generateGuards,
  birthValidate,
  spawnGenerateRunner,
  retryCacheKey,
  AuthoredBatchSchema,
  type GenerateRunner,
  type ExtractRunner,
  type BirthCandidate,
  type SectionInput,
  type ExtractedClaim,
  type ProbeTranscript,
  type AuthorUserContext,
  type AuthorClaim,
} from '@truecourse/guard-generator'
import type { GuardBirthFinding } from '@truecourse/shared'
import type { LlmTransport } from '@truecourse/shared/llm'
import {
  loadScenarios,
  readManifest,
  writeManifest,
  scenariosDir,
  dismissGuardClaim,
  defaultGuardExecutor,
  loadRecipe,
  recipePath,
} from '@truecourse/guard-runner'
import {
  GuardManifestSchema,
  GuardGenerateReportSchema,
  GUARD_FORMAT_VERSION,
  type GuardScenario,
} from '@truecourse/shared'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  bindsFor,
  raw,
  extractBy,
  authorBy,
  reviewBy,
  PASSING_STEPS,
  FAILING_STEPS,
  writeScenarioFile,
  authored,
} from './helpers.js'
import { stubAuxRunners } from './helpers.js'

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
// Two top-level (H2) sections: one CLI-testable, one background prose.
const DOC_CONTENT = [
  '## version',
  '`relkit --version` prints the version and exits 0.',
  '',
  '## background',
  'The history of relkit; nothing externally observable here.',
].join('\n')

// Two CLI-testable sections — for isolating a per-claim authoring failure.
const TWO_CLI_DOC = 'docs/two.md'
const TWO_CLI_CONTENT = [
  '## version',
  '`relkit --version` prints the version and exits 0.',
  '',
  '## help',
  '`relkit --version` also answers here and exits 0.',
].join('\n')

/** version testable, background untestable — the honesty baseline. */
const versionCliBgUntestable = extractBy({ background: { untestable: 'design history, nothing observable' } })

describe('generateGuards — extraction honesty + manifest', () => {
  it('records untestable sections as coverage gaps and settles both in the manifest', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: [raw('relkit --version prints the version', PASSING_STEPS)] }),
    })

    expect(res.status).toBe('ok')
    expect(res.written.map((w) => w.anchor)).toEqual(['version'])
    const gap = res.coverageGaps.find((g) => g.anchor === 'background')!
    expect(gap.kind).toBe('untestable')
    expect(gap.reason).toMatch(/history/)

    // The manifest records both — the untestable section is settled (scenarioIds []).
    const manifest = readManifest(r)!
    const bg = manifest.sections.find((s) => s.anchor === 'background')!
    expect(bg.classification).toMatchObject({ untestable: true })
    expect(bg.scenarioIds).toEqual([])
    expect(bg.generationInputsHash).toMatch(/^sha256:/)
    const ver = manifest.sections.find((s) => s.anchor === 'version')!
    expect(ver.scenarioIds).toEqual(['version.1'])
    expect(ver.classification).toMatchObject({ driver: 'cli' })
  })

  it('records an api-driver claim as a coverage gap (recorded, not authored)', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractBy({
        version: [{ driver: 'api', reason: 'returns a 200 with the version body' }],
        background: { untestable: 'history' },
      }),
      generateRunner: authorBy({}),
    })

    expect(res.written).toEqual([])
    const gap = res.coverageGaps.find((g) => g.anchor === 'version')!
    // Un-conflated: a non-runnable driver is one `awaiting-driver` kind + the driver.
    expect(gap.kind).toBe('awaiting-driver')
    expect(gap.driver).toBe('api')
    // Settled with an api classification — a visible, recorded gap.
    expect(readManifest(r)!.sections.find((s) => s.anchor === 'version')!.classification).toMatchObject({ driver: 'api' })
  })

  it('records a library-driver claim (programmatic API) as a coverage gap, not a scenario', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractBy({
        version: [{ driver: 'library', reason: 'register() hooks the loader when imported from user code' }],
        background: { untestable: 'history' },
      }),
      generateRunner: authorBy({}),
    })

    // No scenario is authored for an import-by-name programmatic API until the
    // library driver ships — the section surfaces as an honest awaiting gap.
    expect(res.written).toEqual([])
    const gap = res.coverageGaps.find((g) => g.anchor === 'version')!
    expect(gap.kind).toBe('awaiting-driver')
    expect(gap.driver).toBe('library')
    expect(readManifest(r)!.sections.find((s) => s.anchor === 'version')!.classification).toMatchObject({ driver: 'library' })
  })
})

describe('generateGuards — blocked-on world-state gaps', () => {
  it('records a blocked-on gap with normalized capabilities and settles the section', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    // The claim needs world-state the sandbox can't express — empty scenarios + blockedOn.
    const blocked: GenerateRunner = async ({ claims }) =>
      authored(claims.map((c) => ({ ref: c.ref, scenarios: [], blockedOn: ['Git', ' git ', 'DB'] })))

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: blocked,
    })

    expect(res.written).toEqual([])
    const gap = res.coverageGaps.find((g) => g.anchor === 'version')!
    expect(gap.kind).toBe('blocked-on')
    // lowercased, trimmed, deduped → "git, db".
    expect(gap.reason).toBe('blocked on git, db: version claim')

    // The section still SETTLES — recorded in the manifest with no scenarios.
    const ver = readManifest(r)!.sections.find((s) => s.anchor === 'version')!
    expect(ver.scenarioIds).toEqual([])
    expect(ver.classification).toMatchObject({ driver: 'cli' })
  })

  it('ignores blockedOn when the claim also authored scenarios', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const runner: GenerateRunner = async ({ claims }) =>
      authored(claims.map((c) => ({ ref: c.ref, scenarios: [raw('v', PASSING_STEPS)], blockedOn: ['db'] })))

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: runner,
    })

    expect(res.written.map((w) => w.anchor)).toEqual(['version'])
    expect(res.coverageGaps.some((g) => g.kind === 'blocked-on')).toBe(false)
    expect(res.coverageGaps.some((g) => g.anchor === 'version')).toBe(false)
  })

  it('empty scenarios with no blockedOn stays a no-claim gap', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: [] }),
    })

    const gap = res.coverageGaps.find((g) => g.anchor === 'version')!
    expect(gap.kind).toBe('no-claim')
    expect(gap.reason).toMatch(/no CLI scenario/)
  })

  it('replays the blocked-on gap from the per-claim cache without re-authoring', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const blocked: GenerateRunner = async ({ claims }) =>
      authored(claims.map((c) => ({ ref: c.ref, scenarios: [], blockedOn: ['db'] })))
    await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: blocked })

    // Reset the manifest so `version` is work again; authoring is a per-claim cache HIT.
    writeManifest(r, { guard: GUARD_FORMAT_VERSION, sections: [] })
    let authorCalls = 0
    const res2 = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: (async ({ claims }) => {
        authorCalls++
        return authored(claims.map((c) => ({ ref: c.ref, scenarios: [] })))
      }) as GenerateRunner,
    })

    expect(authorCalls).toBe(0) // served from the per-claim authoring cache
    const gap = res2.coverageGaps.find((g) => g.anchor === 'version')!
    expect(gap.kind).toBe('blocked-on')
    expect(gap.reason).toBe('blocked on db: version claim')
  })
})

describe('generateGuards — change detection', () => {
  it('does zero LLM work on a second run with unchanged sections', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
    })

    let extractCalls = 0
    let authorCalls = 0
    const res2 = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractBy({ background: { untestable: 'bg' } }, () => extractCalls++),
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }, () => authorCalls++),
    })

    expect(res2.noChanges).toBe(true)
    expect(res2.sectionsChanged).toBe(0)
    expect(extractCalls).toBe(0)
    expect(authorCalls).toBe(0)
  })

  it('re-authors from the per-claim cache without a second authoring call', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
    })

    // Force the whole pipeline to re-run (fresh manifest), but keep the same doc:
    // extraction re-runs (a cold runner), authoring is a per-claim cache HIT.
    writeManifest(r, { guard: GUARD_FORMAT_VERSION, sections: [] })
    let authorCalls = 0
    const res2 = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }, () => authorCalls++),
    })

    expect(res2.written.map((w) => w.anchor)).toEqual(['version'])
    expect(authorCalls).toBe(0) // served from the per-claim authoring cache
  })
})

describe('generateGuards — write + binds enforcement', () => {
  it('writes valid YAML that the loader parses, with binds pinned to the live index', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, DOC_CONTENT)

    // The model returns a WRONG binding; the engine must overwrite it.
    const wrong = raw('v', PASSING_STEPS, {
      // @ts-expect-error — passthrough tolerates (and ignores) engine-owned fields
      binds: { doc: 'other.md', section: 'nope', fingerprint: 'sha256:wrong' },
    })
    await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: [wrong] }),
    })

    const { scenarios, errors } = loadScenarios(r)
    expect(errors).toEqual([])
    const written = scenarios.find((s) => s.id === 'version.1')!
    const live = bindsFor(r, DOC, 'version')
    expect(written.binds).toEqual(live)
    // Written under the area slug directory.
    expect(fs.existsSync(path.join(scenariosDir(r), 'tools-relkit', 'version.1.yaml'))).toBe(true)
  })
})

describe('generateGuards — id assignment', () => {
  it('assigns collision-safe `<leaf>.<n>` ids across multiple scenarios', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: [raw('a', PASSING_STEPS), raw('b', PASSING_STEPS)] }),
    })
    expect(res.written.map((w) => w.id).sort()).toEqual(['version.1', 'version.2'])
  })

  it('never reuses a hand-written scenario id and never deletes its file', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const handWritten: GuardScenario = {
      guard: GUARD_FORMAT_VERSION,
      id: 'version.1',
      title: 'hand-written',
      binds: bindsFor(r, DOC, 'version'),
      driver: 'cli',
      steps: [{ run: ['--version'], expect: { exit: 0 } }],
      normalize: [],
    }
    writeScenarioFile(r, 'manual/version.1.yaml', handWritten)

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: [raw('generated', PASSING_STEPS)] }),
    })
    // Generated id skips the taken `.1`.
    expect(res.written.map((w) => w.id)).toEqual(['version.2'])
    // The hand-written file is untouched.
    expect(fs.existsSync(path.join(scenariosDir(r), 'manual', 'version.1.yaml'))).toBe(true)
  })
})

describe('generateGuards — birth validation', () => {
  it('persists a scenario that passes at birth', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
    })
    expect(res.written).toHaveLength(1)
    expect(res.birthFindings).toEqual([])
    expect(loadScenarios(r).scenarios.map((s) => s.id)).toEqual(['version.1'])
  })

  it('retries a failing claim ONCE with the evidence, then persists the fix', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    let calls = 0
    const retryRunner: GenerateRunner = async ({ claims }) => {
      calls++
      // First attempt fails at birth; the retry (evidence attached) fixes it.
      return authored(claims.map((c) => ({ ref: c.ref, scenarios: c.retry ? [raw('fixed', PASSING_STEPS)] : [raw('broken', FAILING_STEPS)] })))
    }

    const res = await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: retryRunner })
    expect(calls).toBe(2) // round 1 batch + one retry
    expect(res.written.map((w) => w.title)).toEqual(['fixed'])
    expect(res.birthFindings).toEqual([])
    expect(loadScenarios(r).scenarios).toHaveLength(1)
  })

  it('commits the passing scenario AND the failing one (item 3 — no triage ⇒ real drift)', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    // One claim, two scenarios: `good` passes, `bad` always fails at birth (retry
    // keeps failing). No triage runner ⇒ `bad` is real drift, so BOTH commit; `good`
    // clean, `bad` carrying a diagnosis. Nothing is withheld.
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: [raw('good', PASSING_STEPS), raw('bad', FAILING_STEPS)] }),
    })

    expect(res.written.map((w) => w.title).sort()).toEqual(['bad', 'good'])
    expect(res.birthFindings).toEqual([])
    // The failing one carries a diagnosis; the passing one does not.
    expect(res.written.find((w) => w.title === 'bad')!.diagnosis).toBeDefined()
    expect(res.written.find((w) => w.title === 'good')!.diagnosis).toBeUndefined()
    expect(loadScenarios(r).scenarios.map((s) => s.title).sort()).toEqual(['bad', 'good'])
    // The section committed BOTH scenarios and carries no residue ⇒ it settles CLEAN
    // (non-null hash), skipped next generate; `bad` keeps failing at `guard run`.
    const entry = readManifest(r)!.sections.find((s) => s.anchor === 'version')!
    expect(entry.scenarioIds).toHaveLength(2)
    expect(entry.generationInputsHash).not.toBeNull()
  })

  it('commits a still-failing scenario as real drift with its diagnosis (item 3)', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: [raw('always broken', FAILING_STEPS)] }),
    })

    expect(res.birthFindings).toEqual([])
    expect(res.written).toHaveLength(1)
    const w = res.written[0]
    expect(w.title).toBe('always broken')
    expect(w.anchor).toBe('version')
    expect(w.diagnosis?.actual).toContain('exit')
    expect(w.diagnosis?.evidencePath).toMatch(/guard\/evidence/)
    // Committed to disk and settled CLEAN — the drift stands until code/doc is fixed.
    expect(loadScenarios(r).scenarios.map((s) => s.title)).toEqual(['always broken'])
    const entry = readManifest(r)!.sections.find((s) => s.anchor === 'version')!
    expect(entry.scenarioIds).toHaveLength(1)
    expect(entry.generationInputsHash).not.toBeNull()
  })
})

describe('generateGuards — failure output excerpts (Fix 1)', () => {
  it('a committed drift scenario carries the failing run raw stderr; the empty stdout is omitted', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    // FAILING_STEPS runs `boom` → exit 7, stderr "fatal: intentional failure".
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: [raw('always broken', FAILING_STEPS)] }),
    })
    const diagnosis = res.written[0].diagnosis!
    expect(diagnosis.stderr).toContain('fatal: intentional failure')
    expect(diagnosis.stdout).toBeUndefined()
  })

  it('threads the failing run output into the retry evidence the model sees', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    let retryStderr: string | undefined
    let retryStdout: unknown = 'SENTINEL'
    const runner: GenerateRunner = async ({ claims }) =>
      authored(
        claims.map((c) => {
          if (c.retry) {
            retryStderr = c.retry.stderr
            retryStdout = c.retry.stdout
            return { ref: c.ref, scenarios: [raw('fixed', PASSING_STEPS)] }
          }
          return { ref: c.ref, scenarios: [raw('broken', FAILING_STEPS)] }
        }),
      )

    const res = await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: runner })
    expect(res.written.map((w) => w.title)).toEqual(['fixed'])
    expect(retryStderr).toContain('fatal: intentional failure')
    // boom writes nothing to stdout → the retry evidence omits it.
    expect(retryStdout).toBeUndefined()
  })
})

describe('retryCacheKey — excerpt sensitivity (Fix 1)', () => {
  const claim: ExtractedClaim = {
    claim: 'add records an expense',
    driver: 'cli',
    sectionAnchor: 'add',
    reason: 'exit code is observable',
  }
  const section: SectionInput = {
    doc: 'docs/cli.md',
    anchor: 'add',
    fingerprint: 'sha256:s',
    headingText: 'add',
    level: 2,
    ownText: '',
    fullText: '',
    areaTags: [],
  }
  const base: GuardBirthFinding = { doc: 'docs/cli.md', anchor: 'add', title: 't', step: 1, expected: 'exit 3', actual: 'exit 2' }

  it('moves when the evidence excerpts differ', () => {
    const a = retryCacheKey(claim, section, 'fp', { ...base, stderr: 'usage A' })
    const b = retryCacheKey(claim, section, 'fp', { ...base, stderr: 'usage B' })
    expect(a).not.toBe(b)
  })

  it('is stable for identical evidence', () => {
    const a = retryCacheKey(claim, section, 'fp', { ...base, stderr: 'usage A' })
    const b = retryCacheKey(claim, section, 'fp', { ...base, stderr: 'usage A' })
    expect(a).toBe(b)
  })

  it('a pre-change entry (no excerpts) never collides with one carrying excerpts', () => {
    const without = retryCacheKey(claim, section, 'fp', base)
    const withExcerpt = retryCacheKey(claim, section, 'fp', { ...base, stderr: 'usage' })
    expect(without).not.toBe(withExcerpt)
  })
})

describe('generateGuards — committed drift + greens (item 3)', () => {
  it('a section with one drift + two green siblings COMMITS all three', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    // Three claims in ONE section: two author passing scenarios, one authors a
    // failing scenario. No triage ⇒ the failing one is real drift, so all three
    // COMMIT (the greens clean, the drift carrying a diagnosis) — nothing withheld.
    const threeClaims = extractBy({
      version: [{ claim: 'C_G1' }, { claim: 'C_G2' }, { claim: 'C_BAD' }],
      background: { untestable: 'bg' },
    })
    const authorPerClaim: GenerateRunner = async ({ claims }) =>
      authored(
        claims.map((c) => ({
          ref: c.ref,
          scenarios:
            c.claim === 'C_BAD'
              ? [raw('bad', FAILING_STEPS)]
              : [raw(c.claim === 'C_G1' ? 'g1' : 'g2', PASSING_STEPS)],
        })),
      )

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: threeClaims,
      generateRunner: authorPerClaim,
    })

    expect(res.written.map((w) => w.title).sort()).toEqual(['bad', 'g1', 'g2'])
    expect(res.birthFindings).toEqual([])
    expect(res.written.find((w) => w.title === 'bad')!.diagnosis).toBeDefined()
    // All three committed to disk.
    expect(loadScenarios(r).scenarios.map((s) => s.title).sort()).toEqual(['bad', 'g1', 'g2'])
    // No tool-fault residue ⇒ CLEAN manifest entry (non-null hash), skipped next run.
    const entry = readManifest(r)!.sections.find((s) => s.anchor === 'version')!
    expect(entry.scenarioIds).toHaveLength(3)
    expect(entry.generationInputsHash).not.toBeNull()
  })

  it('a committed drift is a stable no-op next generate (section settled, never re-attempted)', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const twoClaims = extractBy({
      version: [{ claim: 'C_GOOD' }, { claim: 'C_BAD' }],
      background: { untestable: 'bg' },
    })
    const authorPerClaim: GenerateRunner = async ({ claims }) =>
      authored(claims.map((c) => ({ ref: c.ref, scenarios: c.claim === 'C_BAD' ? [raw('bad', FAILING_STEPS)] : [raw('good', PASSING_STEPS)] })))

    const first = await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner: twoClaims, generateRunner: authorPerClaim })
    expect(first.written.map((w) => w.title).sort()).toEqual(['bad', 'good'])
    expect(first.birthFindings).toEqual([])
    expect(loadScenarios(r).scenarios.map((s) => s.id).sort()).toEqual(['version.1', 'version.2'])

    // Run 2 — the section settled CLEAN in run 1 (both claims committed, no residue), so
    // it is unchanged WORK: skipped, nothing re-authored, the committed drift stands.
    const second = await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner: twoClaims, generateRunner: authorPerClaim })
    expect(second.written).toEqual([])
    expect(second.noChanges).toBe(true)
    expect(loadScenarios(r).scenarios.map((s) => s.id).sort()).toEqual(['version.1', 'version.2'])
  })

  it('a cleanly settled section writes a settled manifest entry (non-null hash)', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
    })

    expect(res.written.map((w) => w.anchor)).toEqual(['version'])
    const entry = readManifest(r)!.sections.find((s) => s.anchor === 'version')!
    expect(entry.scenarioIds).toEqual(['version.1'])
    expect(entry.generationInputsHash).not.toBeNull()
  })

  it('a report carrying heldSections round-trips through the report schema', () => {
    const rep = {
      generatedAt: '2026-01-02T03:04:05.000Z',
      status: 'ok' as const,
      sectionsTotal: 1,
      sectionsChanged: 1,
      skippedUnchanged: 0,
      noChanges: false,
      written: [],
      coverageGaps: [],
      birthFindings: [{ doc: DOC, anchor: 'version', title: 'bad', step: 1, expected: 'e', actual: 'a' }],
      errors: [],
      extractionFailures: [],
      orphaned: [],
      birthPassed: 1,
      heldSections: [
        {
          doc: DOC,
          anchor: 'version',
          headingText: 'version',
          readyScenarios: [{ id: 'version.1', title: 'good', yaml: 'guard: 1\nid: version.1\n' }],
        },
      ],
    }
    expect(() => GuardGenerateReportSchema.parse(rep)).not.toThrow()
  })

  it('an old-shape report with no heldSections still parses (optional field)', () => {
    const rep = {
      generatedAt: '2026-01-02T03:04:05.000Z',
      status: 'ok' as const,
      sectionsTotal: 0,
      sectionsChanged: 0,
      skippedUnchanged: 0,
      noChanges: false,
      written: [],
      coverageGaps: [],
      birthFindings: [],
      errors: [],
      extractionFailures: [],
      orphaned: [],
    }
    expect(() => GuardGenerateReportSchema.parse(rep)).not.toThrow()
  })
})

describe('generateGuards — dismissed claims (decisions.json)', () => {
  // Two cli claims in ONE section: BAD authors a failing scenario (no triage ⇒ real
  // drift that COMMITS with a diagnosis — item 3), GOOD a passing one.
  const twoClaims = extractBy({
    version: [{ claim: 'CLAIM_BAD' }, { claim: 'CLAIM_GOOD' }],
    background: { untestable: 'bg' },
  })
  const authorPerClaim: GenerateRunner = async ({ claims }) =>
    authored(
      claims.map((c) => ({
        ref: c.ref,
        scenarios: c.claim === 'CLAIM_BAD' ? [raw('bad', FAILING_STEPS)] : [raw('good', PASSING_STEPS)],
      })),
    )

  it('a committed drift scenario carries its extracted claim (dismissal identity) and binding', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: twoClaims,
      generateRunner: authorPerClaim,
    })

    // `bad` committed as real drift, carrying a diagnosis; its YAML is the committed
    // file, and its `claim` is the dismissal identity a user would key on.
    expect(res.birthFindings).toEqual([])
    expect(res.written.find((w) => w.title === 'bad')!.diagnosis).toBeDefined()
    const committed = loadScenarios(r).scenarios.find((s) => s.title === 'bad')!
    expect(committed.claim).toBe('CLAIM_BAD')
    expect(committed.binds.section).toBe('version')
  })

  it('a dismissed claim is skipped (never authored) and the section settles on its siblings', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    // The user pre-dismisses BAD as noise. Generate skips it BEFORE authoring, so it is
    // never committed; GOOD commits and the section settles CLEAN on GOOD alone.
    dismissGuardClaim(r, { doc: DOC, anchor: 'version', title: 'CLAIM_BAD', dismissedAt: '2026-07-08T00:00:00.000Z' })

    const res = await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner: twoClaims, generateRunner: authorPerClaim })
    expect(res.birthFindings).toEqual([]) // never authored, never findinged
    expect(res.written.map((w) => w.title)).toEqual(['good'])
    expect(res.orphanedDismissals).toEqual([]) // the dismissal matched a live claim
    const dismissedGap = res.coverageGaps.find((g) => g.kind === 'dismissed')!
    expect(dismissedGap).toMatchObject({ doc: DOC, anchor: 'version' })
    expect(dismissedGap.reason).toContain('CLAIM_BAD')

    // GOOD stays committed and the section settles clean (non-null hash).
    const committed = loadScenarios(r).scenarios
    expect(committed.map((s) => s.title)).toEqual(['good'])
    const manifestVersion = readManifest(r)!.sections.find((s) => s.anchor === 'version')!
    expect(manifestVersion.scenarioIds).toEqual(committed.map((s) => s.id))
    expect(manifestVersion.generationInputsHash).not.toBeNull()
  })

  it('a dismissal whose claim text no longer matches any live claim surfaces as orphaned', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    // The section's real claim is the default "version claim"; this dismissal names
    // text that no longer exists (the section content changed since it was authored).
    dismissGuardClaim(r, { doc: DOC, anchor: 'version', title: 'STALE CLAIM TEXT', dismissedAt: '2026-07-08T00:00:00.000Z' })

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
    })

    expect(res.orphanedDismissals).toEqual([{ doc: DOC, anchor: 'version', title: 'STALE CLAIM TEXT' }])
    // The live claim is unaffected — it authors + commits normally.
    expect(res.written.map((w) => w.anchor)).toEqual(['version'])
  })
})

describe('generateGuards — capability/materialization-error retry routing', () => {
  // A scenario declaring a git commit of a file it never seeded via `setup.files`
  // fails materialization with a precise provider message — a generation defect,
  // routed through the same one evidence-retry as a birth `fail`.
  const UNSEEDED_GIT = { git: { commits: [{ files: ['README.md'] }] } }

  it('retries a materialization error ONCE with the capability message as evidence, then persists the fix', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    let calls = 0
    let retryEvidence: { expected?: string; actual?: string } | undefined
    const runner: GenerateRunner = async ({ claims }) => {
      calls++
      return authored(
        claims.map((c) => {
          if (c.retry) {
            retryEvidence = { expected: c.retry.expected, actual: c.retry.actual }
            return { ref: c.ref, scenarios: [raw('fixed', PASSING_STEPS)] } // drops the bad git decl
          }
          // Round 1: a git commit of an unseeded file → materialization fails.
          return { ref: c.ref, scenarios: [raw('broken', PASSING_STEPS, { setup: UNSEEDED_GIT })] }
        }),
      )
    }

    const retries: Array<[number, number]> = []
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: runner,
      onRetryProgress: (done, total) => retries.push([done, total]),
    })

    expect(calls).toBe(2) // round-1 batch + exactly one retry
    // The retry carried the git provider's precise message as its evidence.
    expect(retryEvidence?.actual).toContain('declared file does not exist in the sandbox: README.md')
    expect(retryEvidence?.actual).toContain('seed it via setup.files')
    // The capability error ticked the retry round exactly like a birth fail.
    expect(retries).toEqual([
      [0, 1],
      [1, 1],
    ])
    // The re-authored clean scenario births green and is persisted.
    expect(res.written.map((w) => w.title)).toEqual(['fixed'])
    expect(res.errors).toEqual([])
    expect(res.birthFindings).toEqual([])
    expect(res.birthPassed).toBe(1)
    expect(loadScenarios(r).scenarios).toHaveLength(1)
  })

  it('records an error and leaves the section unsettled when the materialization error persists on retry (one retry, never two)', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    let calls = 0
    const runner: GenerateRunner = async ({ claims }) => {
      calls++
      // Both round 1 AND the retry declare the same unseeded git file → the second
      // materialization failure is recorded as an error, never re-retried.
      return authored(
        claims.map((c) => ({
          ref: c.ref,
          scenarios: [raw(c.retry ? 'still-broken' : 'broken', PASSING_STEPS, { setup: UNSEEDED_GIT })],
        })),
      )
    }

    const res = await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: runner })

    expect(calls).toBe(2) // round-1 batch + exactly one retry, no second
    expect(res.written).toEqual([])
    expect(res.birthFindings).toEqual([])
    const err = res.errors.find((e) => e.anchor === 'version')!
    expect(err.message).toContain('declared file does not exist in the sandbox: README.md')
    // Unsettled → no manifest entry, nothing on disk → re-attempted next run.
    expect(loadScenarios(r).scenarios).toEqual([])
    expect(readManifest(r)!.sections.find((s) => s.anchor === 'version')).toBeUndefined()
  })

  it('caches the materialization-error retry: a rerun reaches the same outcome without re-authoring', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    let round1Calls = 0
    let retryCalls = 0
    const runner: GenerateRunner = async ({ claims }) => {
      if (claims.some((c) => c.retry)) retryCalls++
      else round1Calls++
      return authored(
        claims.map((c) => ({
          ref: c.ref,
          scenarios: c.retry ? [raw('fixed', PASSING_STEPS)] : [raw('broken', PASSING_STEPS, { setup: UNSEEDED_GIT })],
        })),
      )
    }

    const res1 = await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: runner })
    expect(res1.written.map((w) => w.title)).toEqual(['fixed'])
    expect(round1Calls).toBe(1)
    expect(retryCalls).toBe(1)

    // Reset the manifest so `version` is work again; BOTH the round-1 authoring and
    // the capability-error retry are now per-claim cache hits — the runner is not called.
    writeManifest(r, { guard: GUARD_FORMAT_VERSION, sections: [] })
    round1Calls = 0
    retryCalls = 0
    const res2 = await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: runner })

    expect(round1Calls).toBe(0) // round-1 authoring cache hit
    expect(retryCalls).toBe(0) // capability-error retry cache hit
    expect(res2.written.map((w) => w.title)).toEqual(['fixed'])
    expect(res2.birthPassed).toBe(1)
  })
})

describe('generateGuards — malformed extraction (re-ask + fail-soft)', () => {
  it('re-asks ONCE on invalid extraction output and accepts the correction', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    let calls = 0
    const runner: ExtractRunner = async ({ outline, correction }) => {
      calls++
      if (!correction) return { not: 'an extraction' } // first call malformed
      return {
        claims: outline
          .filter((e) => e.anchor === 'version')
          .map((e) => ({ claim: 'v', driver: 'cli', sectionAnchor: e.anchor, reason: 'exit' })),
        untestable: [{ sectionAnchor: 'background', reason: 'bg' }],
      }
    }

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: runner,
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
    })

    expect(calls).toBe(2) // one call + one corrective re-ask
    expect(res.extractionFailures).toEqual([])
    expect(res.written.map((w) => w.anchor)).toEqual(['version'])
  })

  it('records a per-document extraction failure when invalid even after the re-ask; other docs continue', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }, { ref: TWO_CLI_DOC }])
    writeDoc(r, DOC, DOC_CONTENT)
    writeDoc(r, TWO_CLI_DOC, TWO_CLI_CONTENT)

    const runner: ExtractRunner = async ({ doc, outline }) => {
      if (doc === DOC) return { still: 'wrong' } // invalid on both call and re-ask
      return {
        claims: outline.map((e) => ({ claim: 'c', driver: 'cli', sectionAnchor: e.anchor, reason: 'exit' })),
        untestable: [],
      }
    }

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: runner,
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)], help: [raw('h', PASSING_STEPS)] }),
    })

    expect(res.status).toBe('ok') // fail-soft: never throws
    expect(res.extractionFailures.map((f) => f.doc)).toEqual([DOC])
    // The other doc's sections settle + write.
    expect(res.written.map((w) => w.anchor).sort()).toEqual(['help', 'version'])
    const manifest = readManifest(r)!
    // The failed doc's sections are unsettled — no manifest entry (re-attempted next run).
    expect(manifest.sections.find((s) => s.doc === DOC)).toBeUndefined()
    expect(manifest.sections.filter((s) => s.doc === TWO_CLI_DOC)).toHaveLength(2)
  })

  it('a thrown extraction call is a fail-soft failure (not a crash)', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const throwing: ExtractRunner = async () => {
      throw new Error('transport timeout')
    }

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: throwing,
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
    })

    expect(res.status).toBe('ok')
    expect(res.extractionFailures.map((f) => f.doc)).toEqual([DOC])
    expect(res.extractionFailures[0].reason).toMatch(/call failed/)
    expect(res.written).toEqual([])
  })
})

describe('generateGuards — authoring robustness', () => {
  it('an omitted claim ref in a batch errors only that claim; the others are written', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: TWO_CLI_DOC }])
    writeDoc(r, TWO_CLI_DOC, TWO_CLI_CONTENT)

    // The batch carries both claims; the runner returns output only for `help`.
    const gen: GenerateRunner = async ({ claims }) =>
      authored(
        claims
          .filter((c) => c.section.anchor === 'help')
          .map((c) => ({ ref: c.ref, scenarios: [raw('help works', PASSING_STEPS)] })),
      )

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractBy({}), // both sections default to a cli claim
      generateRunner: gen,
    })

    expect(res.status).toBe('ok')
    expect(res.written.map((w) => w.anchor)).toEqual(['help'])
    expect(res.errors.map((e) => e.anchor)).toEqual(['version'])
    const manifest = readManifest(r)!
    expect(manifest.sections.find((s) => s.anchor === 'version')).toBeUndefined()
    expect(manifest.sections.find((s) => s.anchor === 'help')?.scenarioIds).toEqual(['help.1'])
  })

  it('re-asks ONCE on a bare-array authoring output, then aborts — nothing was authored', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    let calls = 0
    const gen: GenerateRunner = async () => {
      calls++
      return [{ ref: 'c0', scenarios: [] }] // array-rooted: invalid on the call AND the re-ask
    }

    const res = await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: gen })

    expect(calls).toBe(2) // authoring call + one corrective re-ask
    // Every authoring call came back unusable → the run never reports success.
    expect(res.status).toBe('llm-failed')
    expect(res.reason).toContain('guard.generate')
    expect(res.written).toEqual([])
    expect(res.errors.map((e) => e.anchor)).toEqual(['version'])
    expect(readManifest(r)?.sections.find((s) => s.anchor === 'version')).toBeUndefined()
  })
})

describe('generateGuards — manifest rewrite + orphans', () => {
  it('carries forward orphaned manifest entries and reports them, and writes a schema-valid manifest', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    // A prior manifest entry whose section no longer exists on disk.
    writeManifest(r, {
      guard: GUARD_FORMAT_VERSION,
      sections: [
        { doc: 'docs/gone.md', anchor: 'removed/section', fingerprint: 'sha256:old', scenarioIds: ['orphan.1'], generationInputsHash: 'sha256:x' },
      ],
    })

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
    })

    expect(res.orphaned).toEqual([{ doc: 'docs/gone.md', anchor: 'removed/section', scenarioIds: ['orphan.1'] }])
    const manifest = readManifest(r)!
    expect(() => GuardManifestSchema.parse(manifest)).not.toThrow()
    // Orphan carried; new section recorded.
    expect(manifest.sections.find((s) => s.anchor === 'removed/section')).toBeTruthy()
    expect(manifest.sections.find((s) => s.anchor === 'version')?.scenarioIds).toEqual(['version.1'])
  })
})

describe('generateGuards — universe + recipe discovery', () => {
  it('errors with a spec-scan hint when there is no corpus', async () => {
    const r = repo()
    const res = await generateGuards({ ...stubAuxRunners(), repoRoot: r })
    expect(res.status).toBe('no-docs')
    expect(res.reason).toMatch(/spec scan/)
  })

  it('the corpus is the only doc authority — committed scenarios do not create a universe', async () => {
    const r = repo()
    writeDoc(r, DOC, DOC_CONTENT)
    writeScenarioFile(r, 'manual/version.1.yaml', {
      guard: 1,
      id: 'version.1',
      title: 'hand-written',
      binds: bindsFor(r, DOC, 'version'),
      driver: 'cli',
      steps: [{ run: ['--version'], expect: { exit: 0 } }],
      normalize: [],
    })
    const res = await generateGuards({ ...stubAuxRunners(), repoRoot: r })
    expect(res.status).toBe('no-docs')
    expect(res.reason).toMatch(/spec scan/)
  })

  it('discovers, verifies, and writes a recipe when none exists', async () => {
    const r = repo()
    // No recipe.json — discovery must propose one and the engine verifies it.
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      recipeRunner: async () => ({ build: 'true', entry: ['node', (await import('./helpers.js')).FIXTURE_BIN] }),
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
    })

    expect(res.status).toBe('ok')
    expect(res.recipe?.status).toBe('discovered')
    expect(fs.existsSync(path.join(scenariosDir(r), 'recipe.json'))).toBe(true)
    expect(res.written).toHaveLength(1)
  })

  it('verifies a proposal with an install step (install runs before the build) and writes it', async () => {
    const r = repo()
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      recipeRunner: async () => ({
        install: 'touch install-marker',
        // The verification build only succeeds when the install already ran.
        build: 'test -f install-marker',
        entry: ['node', (await import('./helpers.js')).FIXTURE_BIN],
      }),
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
    })

    expect(res.status).toBe('ok')
    expect(res.recipe?.status).toBe('discovered')
    const written = JSON.parse(fs.readFileSync(path.join(scenariosDir(r), 'recipe.json'), 'utf-8'))
    expect(written.install).toBe('touch install-marker')
    expect(written.build).toBe('test -f install-marker')
  })

  it('a failing proposal install is verify-failed against the install command; no recipe is written', async () => {
    const r = repo()
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      recipeRunner: async () => ({
        install: 'false',
        build: 'true',
        entry: ['node', (await import('./helpers.js')).FIXTURE_BIN],
      }),
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
    })

    expect(res.status).toBe('recipe-failed')
    if (res.status === 'recipe-failed') expect(res.reason).toMatch(/^install `false` failed/)
    expect(fs.existsSync(path.join(scenariosDir(r), 'recipe.json'))).toBe(false)
  })
})

// A birth candidate whose scenario binds to the live `version` section and runs
// `steps`; the section/claim fields are just carried back through the runner.
function candidate(repo: string, id: string, steps: GuardScenario['steps']): BirthCandidate {
  const binds = bindsFor(repo, DOC, 'version')
  const scenario: GuardScenario = { guard: GUARD_FORMAT_VERSION, id, title: id, binds, driver: 'cli', steps, normalize: [] }
  const section: SectionInput = {
    doc: DOC,
    anchor: 'version',
    fingerprint: binds.fingerprint,
    headingText: 'version',
    level: 2,
    ownText: '',
    fullText: '',
    areaTags: [],
  }
  const claim: ExtractedClaim = { claim: 'c', driver: 'cli', sectionAnchor: 'version', reason: 'exit' }
  return { section, scenario, ref: id, claim }
}

describe('birthValidate — progress forwarding', () => {
  it('forwards per-scenario settle callbacks and the build/run phases to the runner', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const candidates = [
      candidate(r, 'version.1', PASSING_STEPS),
      candidate(r, 'version.2', PASSING_STEPS),
      candidate(r, 'version.3', PASSING_STEPS),
    ]
    const phases: string[] = []
    const settled: number[] = []
    const { outcomes } = await birthValidate(r, candidates, {
      executor: defaultGuardExecutor,
      recipe: loadRecipe(r, recipePath(r))!.recipe,
      skipBuild: false,
      onPhase: (phase) => phases.push(phase),
      onScenarioSettled: (done, total) => {
        expect(total).toBe(3)
        settled.push(done)
      },
    })

    expect(outcomes).toHaveLength(3)
    expect(outcomes.every((o) => o.result.outcome === 'pass')).toBe(true)
    expect(phases).toEqual(['build', 'run']) // build once, then run
    expect(settled).toEqual([1, 2, 3]) // one callback per scenario, monotonic
  })
})

describe('generateGuards — live progress', () => {
  it('fires onBirthProgress once per scenario, with the build/run phases', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const births: Array<[number, number]> = []
    const phases: string[] = []
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: [raw('a', PASSING_STEPS), raw('b', PASSING_STEPS)] }),
      onBirthPhase: (phase) => phases.push(phase),
      onBirthProgress: (done, total) => births.push([done, total]),
    })

    expect(res.written).toHaveLength(2)
    expect(res.birthPassed).toBe(2)
    // Two scenarios → two birth ticks (not one atomic round update), total = 2.
    expect(births).toEqual([[1, 2], [2, 2]])
    expect(phases).toContain('build')
    expect(phases).toContain('run')
  })

  it('fires onExtractViewProgress with the planned total upfront, then once per view', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: 'docs/a.md' }, { ref: 'docs/b.md' }])
    writeDoc(r, 'docs/a.md', '# Alpha\n\nRunning with --version prints the version.\n')
    writeDoc(r, 'docs/b.md', '# Beta\n\nRunning with --version prints the version.\n')

    const views: Array<[number, number]> = []
    await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractBy({}),
      generateRunner: authorBy({}),
      onExtractViewProgress: (done, total) => views.push([done, total]),
    })

    // Two small docs → one view each. The planned denominator is announced up
    // front (0/2 before any call), then the counter ticks per VIEW with the
    // cross-doc total (the live unit — docs alone can sit at 0 for minutes).
    expect(views).toEqual([[0, 2], [1, 2], [2, 2]])
  })

  it('fires onRetryProgress with a per-section-accumulating failed-claim total', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: TWO_CLI_DOC }])
    writeDoc(r, TWO_CLI_DOC, TWO_CLI_CONTENT)

    // Both claims fail birth in round 1; each retry (evidence attached) fixes it.
    const runner: GenerateRunner = async ({ claims }) =>
      authored(claims.map((c) => ({ ref: c.ref, scenarios: c.retry ? [raw('fixed', PASSING_STEPS)] : [raw('broken', FAILING_STEPS)] })))

    const retries: Array<[number, number]> = []
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractBy({}), // both sections default to a cli claim
      generateRunner: runner,
      onRetryProgress: (done, total) => retries.push([done, total]),
    })

    expect(res.written.map((w) => w.title).sort()).toEqual(['fixed', 'fixed'])
    expect(res.birthFindings).toEqual([])
    expect(res.birthPassed).toBe(2) // both retries passed in round 2
    // The pipeline retries per section as each settles, so the total GROWS (1 → 2)
    // rather than being known up front: version announces 1 and settles (0/1, 1/1),
    // then help lifts the total to 2 and settles (1/2, 2/2).
    expect(retries).toEqual([
      [0, 1],
      [1, 1],
      [1, 2],
      [2, 2],
    ])
  })

  it('reconciles birthPassed with written + fidelity-flagged when a sibling forces a retry', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    // One claim, two scenarios: `good` always passes, `bad` always fails. `bad` forces
    // a whole-claim retry that re-authors the same pair, so the round-1 `good` pass is
    // DISCARDED; only the surviving retry `good` pass counts. `good` commits clean and
    // `bad` (no triage ⇒ real drift) COMMITS with a diagnosis (item 3). The discarded
    // round-1 pass no longer inflates the count, so birthPassed reconciles against the
    // CLEAN written (a drift commit never passed birth, so it is excluded).
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: [raw('good', PASSING_STEPS), raw('bad', FAILING_STEPS)] }),
    })

    expect(res.written.map((w) => w.title).sort()).toEqual(['bad', 'good'])
    expect(res.birthFindings).toEqual([])
    const writtenClean = res.written.filter((w) => w.diagnosis === undefined).length
    const fidelityFlagged = res.birthFindings.filter((f) => f.kind === 'fidelity').length
    expect(res.birthPassed).toBe(1) // the discarded round-1 twin no longer counts
    expect(res.birthPassed).toBe(writtenClean + fidelityFlagged + res.autoResolved.length)
  })

  it('reconciles birthPassed when a fidelity flag rides a committed sibling', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    // One claim, two green scenarios: both pass birth, the fidelity reviewer flags `b`.
    // `a` COMMITS on its own merits; `b` is a fidelity finding. Both cleared birth and
    // reached a reported bucket (`a` → written, `b` → fidelity finding), so both count.
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: [raw('a', PASSING_STEPS), raw('b', PASSING_STEPS)] }),
      fidelityRunner: reviewBy({ b: 'weak: asserts less than the claim' }),
    })

    expect(res.written.map((w) => w.title)).toEqual(['a'])
    const fidelityFlagged = res.birthFindings.filter((f) => f.kind === 'fidelity').length
    expect(fidelityFlagged).toBe(1) // the flagged `b`
    expect(res.birthPassed).toBe(2)
    expect(res.birthPassed).toBe(res.written.length + fidelityFlagged + res.autoResolved.length)
  })

  it('fires onSectionSettled per settle with the fixed work-section denominator', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const ticks: Array<[number, number]> = []
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
      onSectionSettled: (settled, total) => ticks.push([settled, total]),
    })

    expect(res.written).toHaveLength(1)
    // background (untestable gap) settles first, version after birth; the total is
    // the run's work-section count, fixed from indexing.
    expect(ticks).toEqual([
      [1, 2],
      [2, 2],
    ])
  })

  it('an unsettled section never ticks onSectionSettled — the counter honestly ends below the total', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const ticks: Array<[number, number]> = []
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      // Authoring returns no output for the claim → `version` errors and never settles
      // (a birth failure would now COMMIT as drift, so an authoring error is the genuine
      // unsettled case).
      generateRunner: async () => authored([]),
      onSectionSettled: (settled, total) => ticks.push([settled, total]),
    })

    expect(res.written).toEqual([])
    expect(res.errors.some((e) => e.anchor === 'version')).toBe(true)
    expect(ticks).toEqual([[1, 2]]) // only the untestable gap settled
  })
})

// ---------------------------------------------------------------------------
// Per-section pipeline: sections settle independently, the build runs parallel
// to authoring, ids never collide across concurrently-settling siblings, and
// retry authoring is cached.
// ---------------------------------------------------------------------------

/** Poll `predicate` until it is true, or reject after `timeoutMs`. */
async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((res) => setTimeout(res, 10))
  }
}

describe('generateGuards — grounded authoring', () => {
  it('captures real behavior and passes the transcripts to the authoring runner', async () => {
    const r = repo()
    writeRecipe(r) // build 'true' → succeeds, so probing runs
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    let received: ProbeTranscript[] | undefined
    const extract = extractBy({
      version: [{ claim: '`--version` prints the version and exits 0' }],
      background: { untestable: 'bg' },
    })
    const gen: GenerateRunner = async (ctx) => {
      received = ctx.probes
      return authored(ctx.claims.map((c) => ({ ref: c.ref, scenarios: [raw('v', PASSING_STEPS)] })))
    }

    const res = await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner: extract, generateRunner: gen })

    expect(res.written.map((w) => w.anchor)).toEqual(['version'])
    expect(received).toBeDefined()
    // The claim named `--version`; relkit prints 2.4.1 at exit 0 in the empty sandbox.
    const probe = received!.find((p) => p.argv.join(' ') === '--version')
    expect(probe).toBeDefined()
    expect(probe!.exit).toBe(0)
    expect(probe!.stdout).toContain('2.4.1')
  })

  it('authors ungrounded (empty probes) when the recipe build fails', async () => {
    const r = repo()
    writeRecipe(r, { build: 'false' }) // build fails → no probing
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    let received: ProbeTranscript[] | undefined
    const gen: GenerateRunner = async (ctx) => {
      received = ctx.probes
      return authored(ctx.claims.map((c) => ({ ref: c.ref, scenarios: [raw('v', PASSING_STEPS)] })))
    }

    const res = await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: gen })

    // The authoring call still happened, but with no transcripts; birth then errors
    // on the broken build so nothing settles.
    expect(received).toEqual([])
    expect(res.written).toEqual([])
    expect(res.errors.length).toBeGreaterThan(0)
  })

  it('runs the recipe install before the birth build (the build sees the install marker)', async () => {
    const r = repo()
    // The birth build only succeeds when the install already ran → order proven.
    writeRecipe(r, { install: 'touch marker', build: 'test -f marker' })
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
    })

    expect(res.status).toBe('ok')
    expect(res.written.map((w) => w.anchor)).toEqual(['version'])
    expect(res.errors).toEqual([])
  })

  it('authors ungrounded and errors on birth when the recipe install fails (exactly like a failing build)', async () => {
    const r = repo()
    writeRecipe(r, { install: 'false', build: 'true' }) // install fails → no probing, birth errors
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    let received: ProbeTranscript[] | undefined
    const gen: GenerateRunner = async (ctx) => {
      received = ctx.probes
      return authored(ctx.claims.map((c) => ({ ref: c.ref, scenarios: [raw('v', PASSING_STEPS)] })))
    }

    const res = await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: gen })

    expect(received).toEqual([])
    expect(res.written).toEqual([])
    expect(res.errors.length).toBeGreaterThan(0)
  })

  it('fires onGroundProgress as probes are planned then captured', async () => {
    const r = repo()
    writeRecipe(r) // build 'true' → probing runs
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const ground: Array<[number, number]> = []
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractBy({
        version: [{ claim: '`--version` prints the version and exits 0' }],
        background: { untestable: 'bg' },
      }),
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
      onGroundProgress: (captured, planned) => ground.push([captured, planned]),
    })

    expect(res.written.map((w) => w.anchor)).toEqual(['version'])
    // Phase 1 is the `--help` surface alone (0/1, 1/1); the exact `--version`
    // fragment runs in phase 2 (1/2, 2/2). No expansion probes (the fixture's
    // help surface names no subcommand the claim also mentions).
    expect(ground).toEqual([
      [0, 1],
      [1, 1],
      [1, 2],
      [2, 2],
    ])
  })

  it('does not fire onGroundProgress when authoring is fully cached (no probes run)', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const runners = {
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: [raw('v', PASSING_STEPS)] }),
    }
    await generateGuards({ ...stubAuxRunners(), repoRoot: r, ...runners })

    // Reset the manifest so `version` is work again; authoring is a per-claim cache
    // HIT → no authoring call and therefore no grounding.
    writeManifest(r, { guard: GUARD_FORMAT_VERSION, sections: [] })
    let groundCalls = 0
    await generateGuards({ ...stubAuxRunners(), repoRoot: r, ...runners, onGroundProgress: () => groundCalls++ })
    expect(groundCalls).toBe(0)
  })
})

describe('generateGuards — per-section pipeline', () => {
  it('persists a section and writes its manifest entry while a sibling is still authoring', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: 'docs/a.md' }, { ref: 'docs/b.md' }])
    writeDoc(r, 'docs/a.md', '## alpha\n`relkit --version` exits 0.\n')
    writeDoc(r, 'docs/b.md', '## beta\n`relkit --version` exits 0.\n')

    let aDurableWhileBInFlight = false
    const gen: GenerateRunner = async ({ doc, claims }) => {
      if (doc === 'docs/b.md') {
        // Block B until section A has FULLY settled — its file + manifest entry.
        await waitFor(() => !!readManifest(r)?.sections.find((s) => s.anchor === 'alpha'), 4000)
        const m = readManifest(r)!
        aDurableWhileBInFlight =
          !!m.sections.find((s) => s.anchor === 'alpha') &&
          !m.sections.find((s) => s.anchor === 'beta') &&
          fs.existsSync(path.join(scenariosDir(r), 'a', 'alpha.1.yaml'))
      }
      return authored(claims.map((c) => ({ ref: c.ref, scenarios: [raw('v', PASSING_STEPS)] })))
    }

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      concurrency: 4, // both docs' batches dispatch concurrently
      extractRunner: extractBy({}), // one cli claim per doc → two independent sections
      generateRunner: gen,
    })

    // A was durable (scenario file + manifest entry) while B was mid-author.
    expect(aDurableWhileBInFlight).toBe(true)
    // Final state matches a barrier run: both sections settled with stable ids.
    expect(res.written.map((w) => w.anchor).sort()).toEqual(['alpha', 'beta'])
    const m = readManifest(r)!
    expect(m.sections.find((s) => s.anchor === 'alpha')?.scenarioIds).toEqual(['alpha.1'])
    expect(m.sections.find((s) => s.anchor === 'beta')?.scenarioIds).toEqual(['beta.1'])
    expect(loadScenarios(r).scenarios.map((s) => s.id).sort()).toEqual(['alpha.1', 'beta.1'])
  })

  it('kicks the recipe build at run start, parallel with authoring', async () => {
    const r = repo()
    // The build writes a marker in the repo root; the author runner waits for it.
    writeRecipe(r, { build: 'touch build-marker' })
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    let sawMarker = false
    const gen: GenerateRunner = async ({ claims }) => {
      // The build was kicked at run start (not after authoring), so its marker
      // shows up WHILE authoring runs — a barrier build (after author) never would.
      await waitFor(() => fs.existsSync(path.join(r, 'build-marker')), 4000)
      sawMarker = true
      return authored(claims.map((c) => ({ ref: c.ref, scenarios: [raw('v', PASSING_STEPS)] })))
    }

    const res = await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: gen })
    expect(sawMarker).toBe(true)
    expect(res.written.map((w) => w.anchor)).toEqual(['version'])
  })

  it('reuses stable ids per section without cross-section collision when one settles first', async () => {
    const r = repo()
    writeRecipe(r)
    // Two docs whose sections share the heading leaf "limits" → same id stem.
    writeCorpus(r, [{ ref: 'docs/a.md' }, { ref: 'docs/b.md' }])
    writeDoc(r, 'docs/a.md', '## limits\n`relkit --version` exits 0.\n')
    writeDoc(r, 'docs/b.md', '## limits\n`relkit --version` exits 0.\n')

    const bindsA = bindsFor(r, 'docs/a.md', 'limits')
    const bindsB = bindsFor(r, 'docs/b.md', 'limits')
    const priorScenario = (id: string, binds: GuardScenario['binds']): GuardScenario => ({
      guard: GUARD_FORMAT_VERSION,
      id,
      title: id,
      binds,
      driver: 'cli',
      steps: [{ run: ['--version'], expect: { exit: 0 } }],
      normalize: [],
    })
    // Prior owned files seed usedIds with limits.1 + limits.2; a STALE manifest makes
    // both sections WORK so they re-author against those inherited stable ids.
    writeScenarioFile(r, 'a/limits.1.yaml', priorScenario('limits.1', bindsA))
    writeScenarioFile(r, 'b/limits.2.yaml', priorScenario('limits.2', bindsB))
    writeManifest(r, {
      guard: GUARD_FORMAT_VERSION,
      sections: [
        { doc: 'docs/a.md', anchor: 'limits', fingerprint: bindsA.fingerprint, scenarioIds: ['limits.1'], generationInputsHash: 'sha256:stale' },
        { doc: 'docs/b.md', anchor: 'limits', fingerprint: bindsB.fingerprint, scenarioIds: ['limits.2'], generationInputsHash: 'sha256:stale' },
      ],
    })

    // A authors TWO scenarios; B authors ONE and blocks until A has fully settled.
    const gen: GenerateRunner = async ({ doc, claims }) => {
      if (doc === 'docs/b.md') {
        await waitFor(() => (readManifest(r)?.sections.find((s) => s.doc === 'docs/a.md')?.scenarioIds.length ?? 0) === 2, 4000)
      }
      const scenarios = doc === 'docs/a.md' ? [raw('a1', PASSING_STEPS), raw('a2', PASSING_STEPS)] : [raw('b1', PASSING_STEPS)]
      return authored(claims.map((c) => ({ ref: c.ref, scenarios })))
    }

    const res = await generateGuards({ ...stubAuxRunners(), repoRoot: r, concurrency: 4, extractRunner: extractBy({}), generateRunner: gen })

    const m = readManifest(r)!
    // A reuses limits.1 and takes the next free stem (limits.3) — never B's limits.2.
    expect(m.sections.find((s) => s.doc === 'docs/a.md')?.scenarioIds).toEqual(['limits.1', 'limits.3'])
    // B keeps its stable limits.2 — no sibling stole it.
    expect(m.sections.find((s) => s.doc === 'docs/b.md')?.scenarioIds).toEqual(['limits.2'])
    const ids = loadScenarios(r).scenarios.map((s) => s.id).sort()
    expect(ids).toEqual(['limits.1', 'limits.2', 'limits.3'])
    expect(new Set(ids).size).toBe(ids.length) // no duplicate ids across sections
    expect(res.written).toHaveLength(3)
  })

  it('caches retry authoring: a rerun reaches the same outcome without re-authoring', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    let round1Calls = 0
    let retryCalls = 0
    const runner: GenerateRunner = async ({ claims }) => {
      if (claims.some((c) => c.retry)) retryCalls++
      else round1Calls++
      return authored(claims.map((c) => ({ ref: c.ref, scenarios: c.retry ? [raw('fixed', PASSING_STEPS)] : [raw('broken', FAILING_STEPS)] })))
    }

    const res1 = await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: runner })
    expect(res1.written.map((w) => w.title)).toEqual(['fixed'])
    expect(round1Calls).toBe(1)
    expect(retryCalls).toBe(1)

    // Reset the manifest so `version` is work again; BOTH the round-1 authoring and
    // the retry authoring are now per-claim cache hits — the runner is not called.
    writeManifest(r, { guard: GUARD_FORMAT_VERSION, sections: [] })
    round1Calls = 0
    retryCalls = 0
    const res2 = await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: runner })

    expect(round1Calls).toBe(0) // round-1 authoring cache hit
    expect(retryCalls).toBe(0) // retry authoring cache hit
    expect(res2.written.map((w) => w.title)).toEqual(['fixed'])
    expect(res2.birthPassed).toBe(1)
  })
})

describe('spawnGenerateRunner — retry stage attribution', () => {
  const section: SectionInput = {
    doc: DOC,
    anchor: 'version',
    fingerprint: 'sha256:x',
    headingText: 'version',
    level: 2,
    ownText: '',
    fullText: '',
    areaTags: [],
  }
  const ctxFor = (claims: AuthorClaim[]): AuthorUserContext => ({
    doc: DOC,
    docContext: 'doc context',
    areaTags: [],
    recipeEntry: ['node', 'bin.mjs'],
    recipeBuild: 'true',
    claims,
  })
  const retry = { scenarioTitle: 't', step: 1, expected: 'e', actual: 'a' }

  it('logs round-1 under guard.generate and a retry under guard.retry with the retry model', async () => {
    const seen: Array<{ stage: string; model?: string }> = []
    const transport: LlmTransport = async (req) => {
      seen.push({ stage: req.stage, model: req.model })
      return '[]'
    }
    const runner = spawnGenerateRunner({ transport, model: 'opus', retryModel: 'sonnet' })
    await runner(ctxFor([{ ref: 'c0', claim: 'v', section }]))
    await runner(ctxFor([{ ref: 'c0', claim: 'v', section, retry }]))
    expect(seen).toEqual([
      { stage: 'guard.generate', model: 'opus' },
      { stage: 'guard.retry', model: 'sonnet' },
    ])
  })

  it('a retry defaults to the generate model when no retry model is configured', async () => {
    const seen: Array<{ stage: string; model?: string }> = []
    const transport: LlmTransport = async (req) => {
      seen.push({ stage: req.stage, model: req.model })
      return '[]'
    }
    const runner = spawnGenerateRunner({ transport, model: 'opus' })
    await runner(ctxFor([{ ref: 'c0', claim: 'v', section, retry }]))
    expect(seen).toEqual([{ stage: 'guard.retry', model: 'opus' }])
  })

  // The claude-code transport answers with prose-free text that may still carry a
  // fence; the runner strips it and hands the engine the batch OBJECT.
  it('strips a fence and parses the batch object the engine validates', async () => {
    const batch = { claims: [{ ref: 'c0', scenarios: [raw('v', PASSING_STEPS)] }] }
    const transport: LlmTransport = async () => '```json\n' + JSON.stringify(batch) + '\n```'
    const runner = spawnGenerateRunner({ transport })
    const out = await runner(ctxFor([{ ref: 'c0', claim: 'v', section }]))
    expect(out).toEqual(batch)
    expect(AuthoredBatchSchema.parse(out).claims.map((c) => c.ref)).toEqual(['c0'])
  })
})
