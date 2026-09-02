/**
 * THE DEPENDENCY CATALOG, run side: the declaration joined with the instance
 * overlay, and the materialization of a registered instance into a sandbox.
 *
 * The contract is narrow and load-bearing: a supplied dependency nobody
 * registered reads `unprovided` (never an error), a half-registered one reads
 * `incomplete`, and a registered instance is materialized as a self-contained
 * COPY — a run can never reach the host original through it.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  DependencyCatalogError,
  loadDependencyCatalog,
  materializeSupplied,
  resolveDependencies,
} from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeRecipe } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

function writeCatalog(r: string, dependencies: unknown[]): void {
  const file = path.join(r, '.truecourse', 'scenarios', 'dependencies.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ dependencies }, null, 2))
}

function writeLocal(r: string, local: unknown): void {
  const file = path.join(r, '.truecourse', 'scenarios', 'dependencies.local.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(local, null, 2))
}

const TARGET = {
  name: 'analysis-target',
  class: 'supplied',
  summary: 'a real project to analyze',
  registration: { kind: 'path', description: 'path to a checked-out project' },
  needs: [
    { flowId: 'claude', need: 'a project with one high finding' },
    { flowId: 'api', need: 'at least one file the rules accept' },
  ],
}

describe('resolveDependencies — declaration ∪ instance overlay', () => {
  it('reads a repo with no catalog as an empty one, never as an error', () => {
    const r = repo()
    expect(loadDependencyCatalog(r).dependencies).toEqual([])
    expect(resolveDependencies(r).catalogExists).toBe(false)
  })

  // Silently ignoring a broken catalog would run scenarios against dependencies
  // nobody checked and blame the program for the failures.
  it('is loud about a catalog that exists and does not parse', () => {
    const r = repo()
    fs.mkdirSync(path.join(r, '.truecourse', 'scenarios'), { recursive: true })
    fs.writeFileSync(path.join(r, '.truecourse', 'scenarios', 'dependencies.json'), '{ broken')
    expect(() => loadDependencyCatalog(r)).toThrow(DependencyCatalogError)
  })

  it('is unprovided with no instance, provided once one is registered', () => {
    const r = repo()
    writeCatalog(r, [TARGET])
    expect(resolveDependencies(r).dependencies[0]).toMatchObject({
      state: 'unprovided',
      requirement: 'a project with one high finding; at least one file the rules accept',
    })

    const fixture = path.join(r, 'fixture-project')
    fs.mkdirSync(fixture)
    writeLocal(r, { 'analysis-target': { path: fixture } })
    expect(resolveDependencies(r).dependencies[0]).toMatchObject({ state: 'provided', hostPath: fixture })
  })

  // A path that no longer exists is the dangerous half-state: it LOOKS registered.
  it('is incomplete — not provided — when a registered path is gone', () => {
    const r = repo()
    writeCatalog(r, [
      { ...TARGET, registration: { kind: 'env', vars: [
        { name: 'A_KEY', description: 'a key', secret: true },
        { name: 'B_KEY', description: 'another', secret: true },
      ] } },
    ])
    writeLocal(r, { 'analysis-target': { env: { A_KEY: 'x' } } })
    const dep = resolveDependencies(r).dependencies[0]
    expect(dep.state).toBe('incomplete')
    expect(dep.requirements.find((q) => q.field === 'B_KEY')?.reason).toMatch(/no value registered/)

    const gone = repo()
    writeCatalog(gone, [TARGET])
    writeLocal(gone, { 'analysis-target': { path: path.join(gone, 'not-here') } })
    expect(resolveDependencies(gone).dependencies[0]).toMatchObject({ state: 'unprovided' })
    expect(resolveDependencies(gone).dependencies[0].requirements[0].reason).toMatch(/does not exist/)
  })

  /**
   * An OPTIONAL variable is offered, never demanded: the program has a default for
   * it, so a blank one is a legitimate answer and must not hold an otherwise
   * complete registration in the state that hard-stops every binding scenario.
   */
  describe('an optional declared variable', () => {
    const CREDENTIALS = {
      name: 'llm-api-credentials',
      class: 'supplied',
      summary: 'a provider API account the CLI can reach the model through',
      registration: {
        kind: 'env',
        vars: [
          { name: 'provider', description: 'the provider id', secret: false },
          { name: 'api-key', description: 'a key for that provider', secret: true },
          {
            name: 'base-url',
            description: 'the provider API base URL — omit for the provider default',
            secret: false,
            optional: true,
          },
        ],
      },
      needs: [{ flowId: 'api', need: 'a key whose live provider probe succeeds' }],
    }

    const resolve = (env: Record<string, string>) => {
      const r = repo()
      writeCatalog(r, [CREDENTIALS])
      writeLocal(r, { 'llm-api-credentials': { env } })
      return { r, dep: resolveDependencies(r).dependencies[0] }
    }

    it('is provided with every REQUIRED variable registered and the optional one blank', () => {
      const { dep } = resolve({ provider: 'anthropic', 'api-key': 'sk-x' })
      expect(dep.state).toBe('provided')
      // Listed and honest about not being registered — but with no reason, because
      // there is nothing to fix.
      const blank = dep.requirements.find((q) => q.field === 'base-url')
      expect(blank).toMatchObject({ resolved: false, optional: true })
      expect(blank!.reason).toBeUndefined()
      expect(dep.env).toEqual({ provider: 'anthropic', 'api-key': 'sk-x' })
    })

    it('is incomplete when a REQUIRED variable is missing, however full the optional one is', () => {
      const { dep } = resolve({ provider: 'anthropic', 'base-url': 'https://llm.internal' })
      expect(dep.state).toBe('incomplete')
      // …and the unresolved requirement names only what is actually missing.
      const unresolved = dep.requirements.filter((q) => !q.resolved && !q.optional)
      expect(unresolved.map((q) => q.reason)).toEqual(['no value registered for `api-key`'])
    })

    it('never lifts an entry off unprovided by itself', () => {
      expect(resolve({ 'base-url': 'https://llm.internal' }).dep.state).toBe('unprovided')
    })

    // A registered optional value materializes like any other: the env instance
    // carries it, and a child sees it under its registered name.
    it('materializes like a required one once registered', () => {
      const { r, dep } = resolve({ provider: 'anthropic', 'api-key': 'sk-x', 'base-url': 'https://llm.internal' })
      expect(dep.state).toBe('provided')
      const sandbox = { cwd: path.join(r, 'sandbox'), home: path.join(r, 'home') }
      const { values } = materializeSupplied([{ name: 'llm-api-credentials', kind: 'env', env: dep.env }], sandbox)
      expect(values['llm-api-credentials']['base-url']).toBe('https://llm.internal')
    })
  })

  it('drops a dismissed flow’s need from the requirement it shows', () => {
    const r = repo()
    writeCatalog(r, [TARGET])
    const rolled = resolveDependencies(r, { dismissedFlows: new Set(['api']) })
    expect(rolled.dependencies[0].requirement).toBe('a project with one high finding')
  })

  it('surfaces overlay entries the catalog never declares instead of honoring them', () => {
    const r = repo()
    writeCatalog(r, [TARGET])
    writeLocal(r, { 'analysis-target': { path: r }, mystery: { path: r } })
    expect(resolveDependencies(r).unknownLocalNames).toEqual(['mystery'])
  })

  /**
   * A catalog entry may change HOW it is registered — an authenticated config
   * directory becoming a token. The instance already on disk is then written in a
   * shape nothing reads, and the honest reading of it is that the dependency is
   * UNREGISTERED: the old value is never guessed at, coerced, or crashed over. It
   * earns one quiet sentence saying why the filled-in overlay is being ignored.
   */
  describe('an instance in the previous registration shape', () => {
    const TOKEN_LOGIN = {
      name: 'tool-login',
      class: 'supplied',
      summary: 'an authenticated tool installation',
      registration: {
        kind: 'env',
        vars: [{ name: 'TOOL_OAUTH_TOKEN', description: 'a long-lived token', secret: true }],
      },
      needs: [{ flowId: 'f', need: 'a login that answers without prompting' }],
    }

    it('reads as unregistered, with a diagnostic instead of a crash', () => {
      const r = repo()
      writeCatalog(r, [TOKEN_LOGIN])
      writeLocal(r, { 'tool-login': { path: '/Users/someone/.toolrc' } })
      const dep = resolveDependencies(r).dependencies[0]
      expect(dep.state).toBe('unprovided')
      expect(dep.env).toEqual({})
      expect(dep.hostPath).toBeUndefined()
      expect(dep.staleInstance).toBe(
        'the registered instance is a path, but this dependency is now registered as ' +
          '`TOOL_OAUTH_TOKEN` — the path is ignored',
      )
    })

    it('still lists the missing variable beside the stale-instance note', () => {
      const r = repo()
      writeCatalog(r, [TOKEN_LOGIN])
      writeLocal(r, { 'tool-login': { path: '/Users/someone/.toolrc' } })
      const dep = resolveDependencies(r).dependencies[0]
      expect(dep.state).toBe('unprovided')
      expect(dep.requirements.map((q) => q.reason)).toEqual(['no value registered for `TOOL_OAUTH_TOKEN`'])
      expect(dep.staleInstance).toMatch(/the path is ignored$/)
    })

    it('is silent when the shapes agree', () => {
      const r = repo()
      writeCatalog(r, [TOKEN_LOGIN])
      writeLocal(r, { 'tool-login': { env: { TOOL_OAUTH_TOKEN: 'sk-ant-oat-x' } } })
      const dep = resolveDependencies(r).dependencies[0]
      expect(dep.state).toBe('provided')
      expect(dep.staleInstance).toBeUndefined()
    })
  })
})

describe('materializeSupplied — the copy is self-contained', () => {
  function sandboxDirs(r: string): { cwd: string; home: string } {
    const cwd = path.join(r, 'sb', 'work')
    const home = path.join(r, 'sb', 'home')
    fs.mkdirSync(cwd, { recursive: true })
    fs.mkdirSync(home, { recursive: true })
    return { cwd, home }
  }

  it('keeps an inside-instance relative link and MATERIALIZES one that points out', () => {
    const r = repo()
    const host = path.join(r, 'host-project')
    fs.mkdirSync(path.join(host, 'pkg'), { recursive: true })
    fs.writeFileSync(path.join(host, 'pkg', 'index.js'), 'inside\n')
    fs.symlinkSync(path.join('pkg', 'index.js'), path.join(host, 'inside-link'))
    const outside = path.join(r, 'outside-secret')
    fs.writeFileSync(outside, 'host-secret\n')
    fs.symlinkSync(outside, path.join(host, 'outside-link'))
    fs.symlinkSync(path.join(r, 'never-existed'), path.join(host, 'dangling-link'))

    const { values } = materializeSupplied(
      [{ name: 'proj', kind: 'path', hostPath: host }],
      sandboxDirs(r),
    )
    const dest = values['proj'].path
    // The pnpm-style in-tree link survives as a link, resolving inside the copy.
    expect(fs.lstatSync(path.join(dest, 'inside-link')).isSymbolicLink()).toBe(true)
    expect(fs.readFileSync(path.join(dest, 'inside-link'), 'utf-8')).toBe('inside\n')
    // The escaping link became a real file: writing through the copy can never
    // reach the host original.
    const copied = path.join(dest, 'outside-link')
    expect(fs.lstatSync(copied).isSymbolicLink()).toBe(false)
    expect(fs.readFileSync(copied, 'utf-8')).toBe('host-secret\n')
    fs.writeFileSync(copied, 'changed in sandbox\n')
    expect(fs.readFileSync(outside, 'utf-8')).toBe('host-secret\n')
    // A dangling link has nothing to copy and is skipped, never a crash.
    expect(fs.existsSync(path.join(dest, 'dangling-link'))).toBe(false)
  })

  it('refuses a config-dir destination that escapes the sandbox HOME', () => {
    const r = repo()
    const host = path.join(r, 'host-config')
    fs.mkdirSync(host, { recursive: true })
    expect(() =>
      materializeSupplied(
        [{ name: 'evil', kind: 'config-dir', hostPath: host, homePath: '../../outside' }],
        sandboxDirs(r),
      ),
    ).toThrow(DependencyCatalogError)
  })
})

describe('the catalog is a recipe-class input', () => {
  it('is folded into the recipe fingerprint, while the instance overlay is not', async () => {
    const r = repo()
    writeRecipe(r)
    const { computeRecipeFingerprint } = await import('@truecourse/guard-runner')
    const bare = computeRecipeFingerprint(r)

    writeCatalog(r, [TARGET])
    const declared = computeRecipeFingerprint(r)
    expect(declared).not.toBe(bare)

    // Registering an instance (or rotating a key) must never re-author anything.
    fs.mkdirSync(path.join(r, 'fixture-project'), { recursive: true })
    writeLocal(r, { 'analysis-target': { path: path.join(r, 'fixture-project') } })
    expect(computeRecipeFingerprint(r)).toBe(declared)
  })
})

describe('the corpus walk', () => {
  it('carries the committed catalog and never the gitignored instances', async () => {
    const r = repo()
    writeRecipe(r)
    writeCatalog(r, [TARGET])
    writeLocal(r, { 'analysis-target': { path: r } })
    const { walkScenarioRelFiles, scenariosDir } = await import('@truecourse/guard-runner')
    const files = walkScenarioRelFiles(scenariosDir(r))
    expect(files).toContain('dependencies.json')
    expect(files).not.toContain('dependencies.local.json')
  })
})

