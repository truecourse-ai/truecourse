import { describe, it, expect, afterEach } from 'vitest'
import {
  generateGuards,
  scenarioCompositionDefect,
  type GenerateRunner,
  type AuthorUserContext,
} from '@truecourse/guard-generator'
import { makeTempRepo, rmrf, writeRecipe, writeDoc, writeCorpus, raw, extractBy, PASSING_STEPS } from './helpers.js'
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
const ONE_SECTION = ['## version', '`relkit --version` prints the version and exits 0.'].join('\n')

/** One authored claim wrapping a single scenario whose step runs `run`. */
const authored = (run: string[]) => [{ ref: 'c0', scenarios: [raw('x', [{ run, expect: { exit: 0 } }])] }]

describe('scenarioCompositionDefect', () => {
  const entry = ['node', 'dist/cli.js']

  it('flags run[0] repeating the entrypoint program name (basename or stem)', () => {
    expect(scenarioCompositionDefect(authored(['node', '--version']), entry)).toContain('run[0]')
    // The entry names `cli.js`; a step leading with its stem `cli` is the same defect.
    expect(scenarioCompositionDefect(authored(['cli', 'build']), entry)).not.toBeNull()
  })

  it('flags a foreign build/package/runtime binary as run[0]', () => {
    expect(scenarioCompositionDefect(authored(['cargo', 'run']), entry)).toContain('cargo')
    expect(scenarioCompositionDefect(authored(['npm', 'test']), entry)).toContain('npm')
    expect(scenarioCompositionDefect(authored(['sqlfluff', 'lint']), entry)).toContain('sqlfluff')
  })

  it('passes argv-only steps (a subcommand, a flag, or the bare entry)', () => {
    expect(scenarioCompositionDefect(authored(['--version']), entry)).toBeNull()
    expect(scenarioCompositionDefect(authored(['check', '--strict']), entry)).toBeNull()
    expect(scenarioCompositionDefect(authored([]), entry)).toBeNull() // bare-entry step
  })

  it('flags an expect matches pattern that does not compile, quoting pattern + error', () => {
    // A Python-style named group — a realistic model mistake, invalid in the JS engine.
    const bad = [
      { ref: 'c0', scenarios: [raw('x', [{ run: ['lint'], expect: { exit: 1, stdout: { matches: '(?P<num>\\d+)' } } }])] },
    ]
    const defect = scenarioCompositionDefect(bad, entry)
    expect(defect).not.toBeNull()
    expect(defect).toContain('(?P<num>')
    expect(defect).toContain('not a valid regular expression')
  })

  it('does not flag a valid matches pattern', () => {
    const good = [
      { ref: 'c0', scenarios: [raw('x', [{ run: ['lint'], expect: { exit: 1, stdout: { matches: "unparsable:.*'2'.*'3'" } } }])] },
    ]
    expect(scenarioCompositionDefect(good, entry)).toBeNull()
  })
})

describe('generateGuards — invalid-regex re-ask', () => {
  it('re-asks once quoting the compile error, then the corrected scenario proceeds', async () => {
    const r = repo()
    writeRecipe(r) // relkit: entry ['node', <bin.mjs>]
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, ONE_SECTION)

    const BAD = '(?P<num>\\d+)'
    let compileErr = ''
    try {
      new RegExp(BAD)
    } catch (e) {
      compileErr = (e as Error).message
    }

    const calls: AuthorUserContext[] = []
    // First (uncorrected) call returns a scenario whose matcher regex is uncompilable;
    // any corrected call returns a valid argv-only scenario — so the engine's re-ask
    // (fed the compile error) is what unblocks it, before any birth cycle is spent.
    const gen: GenerateRunner = async (ctx) => {
      calls.push(ctx)
      const good = ctx.correction !== undefined
      return {
        claims: ctx.claims.map((c) => ({
          ref: c.ref,
          scenarios: [
            good ? raw('good', PASSING_STEPS) : raw('bad', [{ run: ['--version'], expect: { exit: 0, stdout: { matches: BAD } } }]),
          ],
        })),
      }
    }

    const res = await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner: extractBy({}), generateRunner: gen })

    expect(res.status).toBe('ok')
    expect(calls).toHaveLength(2)
    expect(calls[0].correction).toBeUndefined()
    expect(calls[1].correction).toBeDefined()
    // The re-ask quotes the offending pattern AND the exact `new RegExp` compile error.
    expect(calls[1].correction!.invalidOutput).toContain(BAD)
    expect(calls[1].correction!.invalidOutput).toContain(compileErr)

    // The corrected scenario proceeded to birth + persist; the invalid one never did.
    expect(res.written.map((w) => w.title)).toEqual(['good'])
  })
})

describe('generateGuards — run[]-composition re-ask', () => {
  it.each([
    { label: 'entry program name', badRun: ['node', '--version'] },
    { label: 'foreign binary', badRun: ['cargo', 'run'] },
  ])('re-asks once with the corrective message, then the good scenario proceeds ($label)', async ({ badRun }) => {
    const r = repo()
    writeRecipe(r) // relkit: entry ['node', <bin.mjs>]
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, ONE_SECTION)

    const calls: AuthorUserContext[] = []
    // First (uncorrected) call returns the defective batch; any corrected call returns
    // an argv-only good scenario — so the engine's re-ask is what unblocks it.
    const gen: GenerateRunner = async (ctx) => {
      calls.push(ctx)
      const good = ctx.correction !== undefined
      return {
        claims: ctx.claims.map((c) => ({
          ref: c.ref,
          scenarios: [good ? raw('good', PASSING_STEPS) : raw('bad', [{ run: badRun, expect: { exit: 0 } }])],
        })),
      }
    }

    const res = await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner: extractBy({}), generateRunner: gen })

    expect(res.status).toBe('ok')
    // The engine detected the defect and re-asked EXACTLY once, quoting the rule back.
    expect(calls).toHaveLength(2)
    expect(calls[0].correction).toBeUndefined()
    expect(calls[1].correction).toBeDefined()
    expect(calls[1].correction!.invalidOutput).toContain('run[0]')
    expect(calls[1].correction!.invalidOutput).toContain('argv APPENDED')

    // The corrected scenario proceeded to birth + persist; the defective one never did.
    expect(res.written.map((w) => w.title)).toEqual(['good'])
  })

  it('a clean argv-only batch never triggers a re-ask', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, ONE_SECTION)

    const calls: AuthorUserContext[] = []
    const gen: GenerateRunner = async (ctx) => {
      calls.push(ctx)
      return { claims: ctx.claims.map((c) => ({ ref: c.ref, scenarios: [raw('clean', PASSING_STEPS)] })) }
    }

    const res = await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner: extractBy({}), generateRunner: gen })
    expect(res.status).toBe('ok')
    expect(calls).toHaveLength(1) // no correction round
    expect(res.written.map((w) => w.title)).toEqual(['clean'])
  })
})
