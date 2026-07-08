import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { generateGuards } from '@truecourse/guard-generator'
import { readManifest } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeRecipe, writeDoc, writeCorpus, raw, extractBy, authorBy, PASSING_STEPS } from './helpers.js'

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

/** Seed a script whose bare import crashes Node at startup (the live ERR_MODULE_NOT_FOUND). */
function writeCrashingEntry(r: string, rel = 'crash.mjs'): void {
  fs.writeFileSync(path.join(r, rel), "import 'tc-guard-nonexistent-module-xyz'\n")
}

describe('generateGuards — entry pre-flight', () => {
  it('a dead entry records ONE error, zero birth findings, and leaves the section unsettled', async () => {
    const r = repo()
    writeRecipe(r, { build: 'true', entry: ['node', 'crash.mjs'] })
    writeCrashingEntry(r)
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await generateGuards({
      repoRoot: r,
      extractRunner: extractBy({}),
      generateRunner: authorBy({ version: [raw('relkit --version prints the version', PASSING_STEPS)] }),
    })

    expect(res.status).toBe('ok')

    // The dead entry is surfaced ONCE, structurally, with the full startup stderr.
    expect(res.entryPreflight).toBeDefined()
    expect(res.entryPreflight!.entry).toBe('node crash.mjs')
    expect(res.entryPreflight!.buildCommand).toBe('true')
    expect(res.entryPreflight!.stderr).toMatch(/ERR_MODULE_NOT_FOUND|Cannot find package/)

    // ONE loud error, recorded in result errors (never as birth findings).
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0].message).toMatch(/failed to start/)
    expect(res.errors[0].message).toMatch(/ERR_MODULE_NOT_FOUND|Cannot find package/)
    expect(res.errors[0].message).toContain('true') // the rebuild hint names the recipe build

    expect(res.birthFindings).toEqual([])
    expect(res.written).toEqual([])
    expect(res.birthPassed).toBe(0)

    // The section stayed unsettled — nothing persisted to the manifest.
    const manifest = readManifest(r)
    expect((manifest?.sections ?? []).some((s) => s.anchor === 'version')).toBe(false)
  })

  it('an entry naming a NONEXISTENT script → ONE entry-preflight error, ZERO findings (the live cli.js/cli.mjs failure)', async () => {
    // The exact production case (2026-07-08): recipe entry `dist/cli.js`, build
    // produces `dist/cli.mjs`. Pre-fix, birth ran and produced 27 findings; the
    // per-probe sandbox path in node's crash output defeated the invariance check.
    const r = repo()
    fs.mkdirSync(path.join(r, 'dist'))
    fs.writeFileSync(path.join(r, 'dist', 'cli.mjs'), 'export {}\n')
    writeRecipe(r, { build: 'true', entry: ['node', 'dist/cli.js'] })
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await generateGuards({
      repoRoot: r,
      extractRunner: extractBy({}),
      generateRunner: authorBy({ version: [raw('relkit --version prints the version', PASSING_STEPS)] }),
    })

    expect(res.status).toBe('ok')
    expect(res.entryPreflight).toBeDefined()
    expect(res.entryPreflight!.entry).toBe('node dist/cli.js')
    expect(res.entryPreflight!.stderr).toMatch(/Cannot find module|MODULE_NOT_FOUND/) // real node stderr
    expect(res.entryPreflight!.stderr).toContain('entry file not found: dist/cli.js')
    expect(res.entryPreflight!.stderr).toContain('dist/ contains: cli.mjs') // the one-glance mixup hint

    // ONE loud error; zero findings; nothing written; section unsettled.
    expect(res.errors).toHaveLength(1)
    expect(res.birthFindings).toEqual([])
    expect(res.written).toEqual([])
    const manifest = readManifest(r)
    expect((manifest?.sections ?? []).some((s) => s.anchor === 'version')).toBe(false)
  })

  it('a healthy entry (usage-on-no-args) generates normally — no entryPreflight', async () => {
    const r = repo()
    writeRecipe(r) // default fixture entry; relkit exits 64 on no-args but reacts to argv
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await generateGuards({
      repoRoot: r,
      extractRunner: extractBy({}),
      generateRunner: authorBy({ version: [raw('relkit --version prints the version', PASSING_STEPS)] }),
    })

    expect(res.status).toBe('ok')
    expect(res.entryPreflight).toBeUndefined()
    expect(res.written.map((w) => w.anchor)).toEqual(['version'])
    expect(res.errors).toEqual([])
    expect(readManifest(r)!.sections.find((s) => s.anchor === 'version')!.scenarioIds).toEqual(['version.1'])
  })
})

describe('recipe discovery — post-build entry existence check', () => {
  it('a discovered recipe whose entry file does not exist after the build fails verification with the sibling listing', async () => {
    // No recipe.json → discovery runs. The proposal names dist/cli.js while the
    // (no-op) build leaves only dist/cli.mjs — verification must fail LOUDLY with
    // what WAS found nearby, never write recipe.json, and never reach birth.
    const r = repo()
    fs.mkdirSync(path.join(r, 'dist'))
    fs.writeFileSync(path.join(r, 'dist', 'cli.mjs'), 'export {}\n')
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await generateGuards({
      repoRoot: r,
      recipeRunner: async () => ({ build: 'true', entry: ['node', 'dist/cli.js'] }),
      extractRunner: extractBy({}),
      generateRunner: authorBy({}),
    })

    expect(res.status).toBe('recipe-failed')
    expect(res.reason).toContain('entry file not found: dist/cli.js')
    expect(res.reason).toContain('dist/ contains: cli.mjs') // the one-glance mixup hint
    expect(res.reason).toContain('`true`') // names the build that ran
    expect(fs.existsSync(path.join(r, '.truecourse', 'scenarios', 'recipe.json'))).toBe(false)
  })
})
