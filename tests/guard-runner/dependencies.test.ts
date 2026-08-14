/**
 * THE DEPENDENCY GATE, end to end.
 *
 * The engine's contract is narrow and load-bearing: a scenario that binds a supplied
 * dependency with no registered instance NEVER RUNS — it settles `blocked` naming the
 * dependency and the requirement its flows contributed — and one that binds a
 * registered instance runs against a COPY of it, with every `${supplied:…}` resolved
 * to the copy's path inside the sandbox.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  DependencyCatalogError,
  dependencyBlockFor,
  loadDependencyCatalog,
  gitChildEnv,
  materializeSupplied,
  resolveDependencies,
  runGuard,
  scenarioDependencyNames,
  suppliedInstancesFor,
  applySupplied,
  omitsOptionalPair,
} from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeRecipe, writeScenario, scenario, specBinds, FIXTURE_BIN } from './helpers.js'

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
      const { r, dep } = resolve({ provider: 'anthropic', 'base-url': 'https://llm.internal' })
      expect(dep.state).toBe('incomplete')
      // …and the scenario it blocks names only what is actually missing.
      const named = scenario({ id: 'z', needs: ['llm-api-credentials'], steps: [{ run: ['version'] }] })
      const block = dependencyBlockFor(named, resolveDependencies(r))
      expect(block!.detail).toBe('no value registered for `api-key`')
    })

    it('never lifts an entry off unprovided by itself', () => {
      expect(resolve({ 'base-url': 'https://llm.internal' }).dep.state).toBe('unprovided')
    })

    // No special-casing downstream: a registered optional value reaches a scenario
    // through the same `${supplied:…}` resolution every other field uses.
    it('resolves through ${supplied:…} exactly like a required one once registered', () => {
      const { r, dep } = resolve({ provider: 'anthropic', 'api-key': 'sk-x', 'base-url': 'https://llm.internal' })
      expect(dep.state).toBe('provided')
      const named = scenario({
        id: 'z',
        setup: { env: { BASE: '${supplied:llm-api-credentials.base-url}' } },
        steps: [{ run: ['version'] }],
      })
      const sandbox = { cwd: path.join(r, 'sandbox'), home: path.join(r, 'home') }
      const { values } = materializeSupplied(
        suppliedInstancesFor(named, resolveDependencies(r)),
        sandbox,
      )
      expect(applySupplied('${supplied:llm-api-credentials.base-url}', values)).toBe(
        'https://llm.internal',
      )
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

    it('says so in the reason a scenario binding it is blocked', () => {
      const r = repo()
      writeCatalog(r, [TOKEN_LOGIN])
      writeLocal(r, { 'tool-login': { path: '/Users/someone/.toolrc' } })
      const named = scenario({ id: 'z', needs: ['tool-login'], steps: [{ run: ['version'] }] })
      const block = dependencyBlockFor(named, resolveDependencies(r))
      expect(block!.detail).toBe(
        'no value registered for `TOOL_OAUTH_TOKEN`; the registered instance is a path, but ' +
          'this dependency is now registered as `TOOL_OAUTH_TOKEN` — the path is ignored',
      )
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

describe('what a scenario binds', () => {
  const s = scenario({
    id: 'x',
    needs: ['claude-login'],
    setup: { env: { KEY: '${supplied:llm-api-credentials.api-key}' } },
    steps: [{ run: ['show', '${supplied:analysis-target.path}'] }],
  })

  it('counts the declared needs AND every token reference, declared order first', () => {
    expect(scenarioDependencyNames(s)).toEqual([
      'claude-login',
      'analysis-target',
      'llm-api-credentials',
    ])
  })

  // A token against an empty catalog is an authoring defect, and it must block as
  // loudly as a missing instance — never reach a child as a literal string.
  it('blocks on a name the catalog does not declare', () => {
    const r = repo()
    const block = dependencyBlockFor(s, resolveDependencies(r))
    expect(block).toMatchObject({ dependency: 'claude-login' })
    expect(block!.detail).toMatch(/does not declare/)
  })

  // step-creatable / seedable state is obtained by the scenario or the runner, so
  // naming one is not a binding and never gates anything.
  it('does not block on a step-creatable entry', () => {
    const r = repo()
    writeCatalog(r, [{ name: 'a-repo', class: 'step-creatable', summary: 'a git repo', obtain: '`git init`' }])
    const named = scenario({ id: 'y', needs: ['a-repo'], steps: [{ run: ['version'] }] })
    expect(dependencyBlockFor(named, resolveDependencies(r))).toBeNull()
  })
})

describe('runGuard — the gate', () => {
  it('settles blocked (never fail), runs nothing, and names the dependency + requirement', async () => {
    const r = repo()
    writeRecipe(r)
    writeCatalog(r, [TARGET])
    writeScenario(
      r,
      'cli/needs.yaml',
      scenario({
        id: 'needs-target',
        binds: specBinds('cli/version'),
        needs: ['analysis-target'],
        // `tick` appends a line per invocation: if the step ever spawned, the sandbox
        // would carry the evidence. Blocked means it never did.
        steps: [{ run: ['tick'], expect: { exit: 0 } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const [result] = res.latest.scenarios
    expect(result.outcome).toBe('blocked')
    expect(res.latest.summary).toMatchObject({ blocked: 1, fail: 0, error: 0, pass: 0 })
    expect(result.blockedOn).toMatchObject({
      dependency: 'analysis-target',
      requirement: 'a project with one high finding; at least one file the rules accept',
      needs: [
        { flowId: 'claude', need: 'a project with one high finding' },
        { flowId: 'api', need: 'at least one file the rules accept' },
      ],
    })
    expect(result.blockedOn!.registerIn).toContain('dependencies.local.json')
    // Nothing executed, so there is no transcript to write.
    expect(result.evidencePath).toBeUndefined()
    expect(result.durationMs).toBe(0)
  })

  it('runs the scenario once an instance is registered, resolving ${supplied:…} to the sandbox COPY', async () => {
    const r = repo()
    writeRecipe(r)
    writeCatalog(r, [TARGET])
    const fixture = path.join(r, 'fixture-project')
    fs.mkdirSync(fixture, { recursive: true })
    fs.writeFileSync(path.join(fixture, 'README.md'), 'supplied content\n')
    writeLocal(r, { 'analysis-target': { path: fixture } })

    writeScenario(
      r,
      'cli/needs.yaml',
      scenario({
        id: 'needs-target',
        binds: specBinds('cli/version'),
        needs: ['analysis-target'],
        steps: [
          {
            run: ['show', '${supplied:analysis-target.path}/README.md'],
            expect: { exit: 0, stdout: { contains: 'supplied content' } },
          },
          // The run works on a COPY: writing through the resolved path must not reach
          // the registered original.
          { run: ['note', '${supplied:analysis-target.path}/README.md'], expect: { exit: 0 } },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.scenarios[0].outcome).toBe('pass')
    expect(res.latest.summary.blocked).toBe(0)
    expect(fs.readFileSync(path.join(fixture, 'README.md'), 'utf-8')).toBe('supplied content\n')
  })

  it('blocks one variant while its sibling runs — a dependency gates its binder alone', async () => {
    const r = repo()
    writeRecipe(r)
    writeCatalog(r, [TARGET])
    writeScenario(
      r,
      'cli/blocked.yaml',
      scenario({
        id: 'blocked-one',
        binds: specBinds('cli/version'),
        needs: ['analysis-target'],
        steps: [{ run: ['version'], expect: { exit: 0 } }],
      }),
    )
    writeScenario(
      r,
      'cli/free.yaml',
      scenario({
        id: 'free-one',
        binds: specBinds('cli/whoami'),
        steps: [{ run: ['version'], expect: { exit: 0 } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(
      Object.fromEntries(res.latest.scenarios.map((s) => [s.id, s.outcome])),
    ).toEqual({ 'blocked-one': 'blocked', 'free-one': 'pass' })
  })
})

describe('applySupplied', () => {
  it('throws on a field the registration never declared, rather than passing the token through', () => {
    expect(() => applySupplied('${supplied:target.secret}', { target: { path: '/tmp/x' } })).toThrow(
      DependencyCatalogError,
    )
    expect(applySupplied('at ${supplied:target.path}', { target: { path: '/tmp/x' } })).toBe('at /tmp/x')
  })

  it('settles ONE scenario as an error on an undeclared field — the sibling still runs', async () => {
    const r = repo()
    writeRecipe(r)
    writeCatalog(r, [TARGET])
    const fixture = path.join(r, 'fixture-project')
    fs.mkdirSync(fixture, { recursive: true })
    writeLocal(r, { 'analysis-target': { path: fixture } })
    // `pth` is a typo for `path`: the NAME gate passes (the dependency is
    // registered), so the miss can only surface at token resolution — which must
    // fail this scenario alone, never reject the whole run.
    writeScenario(
      r,
      'cli/typo.yaml',
      scenario({
        id: 'typo-field',
        binds: specBinds('cli/version'),
        steps: [{ run: ['show', '${supplied:analysis-target.pth}'], expect: { exit: 0 } }],
      }),
    )
    writeScenario(
      r,
      'cli/free.yaml',
      scenario({
        id: 'free-one',
        binds: specBinds('cli/whoami'),
        steps: [{ run: ['version'], expect: { exit: 0 } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const byId = Object.fromEntries(res.latest.scenarios.map((s) => [s.id, s]))
    expect(byId['typo-field'].outcome).toBe('error')
    expect(byId['typo-field'].failure?.actual).toContain('declares no')
    expect(byId['free-one'].outcome).toBe('pass')
  })

  it('resolves ${supplied:…} in a step env overlay, exactly like argv', async () => {
    const r = repo()
    writeRecipe(r)
    writeCatalog(r, [TARGET])
    const fixture = path.join(r, 'fixture-project')
    fs.mkdirSync(fixture, { recursive: true })
    fs.writeFileSync(path.join(fixture, 'README.md'), 'env-resolved content\n')
    writeLocal(r, { 'analysis-target': { path: fixture } })
    writeScenario(
      r,
      'cli/env.yaml',
      scenario({
        id: 'env-supplied',
        binds: specBinds('cli/version'),
        needs: ['analysis-target'],
        // `env NAME` echoes the variable as the child sees it; a literal
        // `${supplied:…}` reaching the child would fail the assertion.
        steps: [
          {
            run: ['env', 'TARGET_FILE'],
            env: { TARGET_FILE: '${supplied:analysis-target.path}/README.md' },
            expect: {
              exit: 0,
              stdout: { contains: '.tc-supplied/analysis-target/README.md' },
            },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.scenarios[0].outcome).toBe('pass')
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

describe('a config-dir instance', () => {
  it('is copied into the sandbox HOME, so a run cannot touch the real login state', async () => {
    const r = repo()
    writeRecipe(r)
    const hostConfig = path.join(r, 'host-claude')
    fs.mkdirSync(hostConfig, { recursive: true })
    fs.writeFileSync(path.join(hostConfig, 'creds.json'), '{"token":"real"}')
    writeCatalog(r, [
      {
        name: 'tool-login',
        class: 'supplied',
        summary: 'an authenticated tool installation',
        registration: { kind: 'config-dir', homePath: '.toolrc', description: 'the config dir' },
        needs: [{ flowId: 'f', need: 'a login that answers without prompting' }],
      },
    ])
    writeLocal(r, { 'tool-login': { path: hostConfig } })

    writeScenario(
      r,
      'cli/login.yaml',
      scenario({
        id: 'uses-login',
        binds: specBinds('cli/version'),
        needs: ['tool-login'],
        // `show` reads a path relative to the sandbox cwd; the token resolves to the
        // materialized copy inside the sandbox HOME.
        steps: [
          {
            run: ['show', '${supplied:tool-login.path}/creds.json'],
            expect: { exit: 0, stdout: { contains: '"token":"real"' } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.scenarios[0].outcome).toBe('pass')
  })
})

/**
 * THE OMITTABLE ARGV PAIR — `optional: ["--base-url", "${supplied:…}"]`.
 *
 * A registration may declare a variable optional because the program has its own
 * default for it. The scenario still has to name the flag, and the pair is how it
 * says "…unless nobody registered one": registered ⇒ two ordinary argv words,
 * blank ⇒ the flag AND the value drop out, so the program falls back to its default
 * instead of being handed an empty endpoint. Nothing else about token resolution
 * moves — a REQUIRED field still blocks the scenario before anything runs.
 */
describe('an optional argv pair', () => {
  const CREDENTIALS = {
    name: 'llm-api-credentials',
    class: 'supplied',
    summary: 'a provider API account the CLI can reach the model through',
    registration: {
      kind: 'env',
      vars: [
        { name: 'provider', description: 'the provider id', secret: false },
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

  /** Run one scenario whose only step carries the pair; return its result + argv. */
  async function runWithOverlay(
    env: Record<string, string>,
  ): Promise<{ outcome: string; argv: string[]; blockedOn?: string }> {
    const r = repo()
    writeRecipe(r)
    writeCatalog(r, [CREDENTIALS])
    writeLocal(r, { 'llm-api-credentials': { env } })
    writeScenario(
      r,
      'cli/credentials.yaml',
      scenario({
        id: 'uses-credentials',
        binds: specBinds('cli/version'),
        needs: ['llm-api-credentials'],
        steps: [
          {
            run: [
              'version',
              '--provider',
              '${supplied:llm-api-credentials.provider}',
              { optional: ['--base-url', '${supplied:llm-api-credentials.base-url}'] },
            ],
            expect: { exit: 0, stdout: { contains: '.' } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error(`run did not settle: ${res.status}`)
    const [result] = res.latest.scenarios
    if (!result.evidencePath) {
      return { outcome: result.outcome, argv: [], blockedOn: result.blockedOn?.dependency }
    }
    // The transcript records what the child was ACTUALLY spawned with — the only
    // honest place to read an argv the runner assembled.
    const invocation = JSON.parse(
      fs.readFileSync(path.join(r, result.evidencePath, 'invocation.json'), 'utf-8'),
    ) as { steps: { argv: string[] }[] }
    return { outcome: result.outcome, argv: invocation.steps[0].argv }
  }

  it('passes the pair through, resolved, when the optional field is registered', async () => {
    const { outcome, argv } = await runWithOverlay({
      provider: 'anthropic',
      'base-url': 'https://llm.internal/v1',
    })
    expect(outcome).toBe('pass')
    expect(argv.slice(-4)).toEqual([
      '--provider',
      'anthropic',
      '--base-url',
      'https://llm.internal/v1',
    ])
  })

  it('drops the flag AND its value when the optional field is blank — the command still runs', async () => {
    const { outcome, argv } = await runWithOverlay({ provider: 'anthropic' })
    expect(outcome).toBe('pass')
    expect(argv.slice(-3)).toEqual(['version', '--provider', 'anthropic'])
    expect(argv).not.toContain('--base-url')
    // And certainly not the literal token: a dropped pair is dropped, never emptied.
    expect(argv.join(' ')).not.toContain('${supplied:')
  })

  it('still blocks the whole scenario when a REQUIRED field is unregistered', async () => {
    const { outcome, argv, blockedOn } = await runWithOverlay({
      'base-url': 'https://llm.internal/v1',
    })
    // A registered OPTIONAL field lifts nothing: the pair mechanism is about what a
    // machine may leave blank, never about what it must supply.
    expect(outcome).toBe('blocked')
    expect(argv).toEqual([])
    expect(blockedOn).toBe('llm-api-credentials')

    const r = repo()
    writeCatalog(r, [CREDENTIALS])
    writeLocal(r, { 'llm-api-credentials': { env: { 'base-url': 'https://llm.internal/v1' } } })
    const named = scenario({
      id: 'z',
      needs: ['llm-api-credentials'],
      steps: [{ run: ['version'] }],
    })
    expect(dependencyBlockFor(named, resolveDependencies(r))!.detail).toBe(
      'no value registered for `provider`',
    )
  })

  it('resolves a pair naming a registered field like any other token', () => {
    const omissions = new Set(['llm-api-credentials.base-url'])
    expect(omitsOptionalPair('${supplied:llm-api-credentials.base-url}', omissions)).toBe(true)
    expect(omitsOptionalPair('${supplied:llm-api-credentials.model}', omissions)).toBe(false)
    expect(omitsOptionalPair('--base-url', omissions)).toBe(false)
  })

  it('reports the blank optional fields materialization saw, and only those', () => {
    const r = repo()
    writeCatalog(r, [CREDENTIALS])
    writeLocal(r, { 'llm-api-credentials': { env: { provider: 'anthropic' } } })
    const named = scenario({
      id: 'z',
      needs: ['llm-api-credentials'],
      steps: [{ run: ['version'] }],
    })
    const { omissions } = materializeSupplied(
      suppliedInstancesFor(named, resolveDependencies(r)),
      { cwd: path.join(r, 'sandbox'), home: path.join(r, 'home') },
    )
    expect([...omissions]).toEqual(['llm-api-credentials.base-url'])
  })
})

/**
 * A registered variable whose NAME is a legal environment identifier is exported to
 * the scenario's child — the path that makes a token registration work without the
 * scenario placing it anywhere (the program reads `CLAUDE_CODE_OAUTH_TOKEN` itself).
 */
describe('a token registration', () => {
  it('auto-exports into the child env, so the spawned program finds it', async () => {
    const r = repo()
    writeRecipe(r)
    writeCatalog(r, [
      {
        name: 'tool-login',
        class: 'supplied',
        summary: 'an authenticated tool installation',
        registration: {
          kind: 'env',
          vars: [
            { name: 'TOOL_OAUTH_TOKEN', description: 'a long-lived token', secret: true },
          ],
        },
        needs: [{ flowId: 'f', need: 'a token that answers without prompting' }],
      },
    ])
    writeLocal(r, { 'tool-login': { env: { TOOL_OAUTH_TOKEN: 'oat-abc' } } })
    writeScenario(
      r,
      'cli/login.yaml',
      scenario({
        id: 'uses-token',
        binds: specBinds('cli/version'),
        needs: ['tool-login'],
        // The scenario names the variable nowhere: `env` echoes what the child got.
        steps: [
          {
            run: ['env', 'TOOL_OAUTH_TOKEN'],
            expect: { exit: 0, stdout: { equals: 'TOOL_OAUTH_TOKEN=oat-abc\n' } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.scenarios[0].outcome).toBe('pass')
  })
})

/**
 * A registered env value must actually REACH the program — the whole point of
 * registering a token is that the child authenticates with it. The sandbox builds
 * its env from an allowlist (no `process.env` spread), so an exported value has to
 * survive that construction, ride EVERY step of the scenario that bound it, and
 * survive a step's own `env` overlay and the git-step identity layer on top.
 *
 * The values here are fake by construction: the probe echoes them to stdout, which
 * is exactly what a real credential must never do.
 */
describe('a bound env dependency reaches the child process', () => {
  const TOOL_LOGIN = {
    name: 'tool-login',
    class: 'supplied',
    summary: 'an authenticated tool installation',
    registration: {
      kind: 'env',
      vars: [
        // A legal environment identifier — the program reads it by itself.
        { name: 'TOOL_OAUTH_TOKEN', description: 'a long-lived token', secret: true },
        // NOT a legal identifier — a registration FIELD, reachable only via `${supplied:…}`.
        { name: 'api-key', description: 'a provider key', secret: true },
      ],
    },
    needs: [{ flowId: 'f', need: 'a login that answers without prompting' }],
  }
  const INSTANCE = { 'tool-login': { env: { TOOL_OAUTH_TOKEN: 'fake-oat-value', 'api-key': 'fake-key' } } }

  it('exports it into every step, through the allowlist, under a step overlay and on a git step', async () => {
    const r = repo()
    writeRecipe(r)
    writeCatalog(r, [TOOL_LOGIN])
    writeLocal(r, INSTANCE)
    writeScenario(
      r,
      'cli/login.yaml',
      scenario({
        id: 'binds-a-login',
        binds: specBinds('cli/version'),
        needs: ['tool-login'],
        steps: [
          // The first step the scenario runs already has it…
          {
            run: ['env', 'TOOL_OAUTH_TOKEN'],
            expect: { exit: 0, stdout: { contains: 'TOOL_OAUTH_TOKEN=fake-oat-value' } },
          },
          // …so does a LATER one (the export is the scenario's env, not one child's)…
          {
            run: ['env', 'TOOL_OAUTH_TOKEN'],
            expect: { exit: 0, stdout: { contains: 'TOOL_OAUTH_TOKEN=fake-oat-value' } },
          },
          // …a step declaring its own overlay ADDS to it rather than replacing it…
          {
            run: ['env', 'TOOL_OAUTH_TOKEN', 'STEP_ONLY'],
            env: { STEP_ONLY: 'yes' },
            expect: {
              exit: 0,
              stdout: { contains: 'TOOL_OAUTH_TOKEN=fake-oat-value\nSTEP_ONLY=yes' },
            },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error(`expected ok, got ${res.status}`)
    const [result] = res.latest.scenarios
    expect(result.failure).toBeUndefined()
    expect(result.outcome).toBe('pass')

    // The git-step layer adds identity ON TOP of that same env — a `git` step of a
    // scenario that bound a login carries it too. (git itself cannot echo an env
    // var, so the layer is asserted where it is built.)
    expect(gitChildEnv({ TOOL_OAUTH_TOKEN: 'fake-oat-value' }).TOOL_OAUTH_TOKEN).toBe(
      'fake-oat-value',
    )
  })

  it('exports only the names a child can carry — a registration FIELD stays a token', async () => {
    const r = repo()
    writeRecipe(r)
    writeCatalog(r, [TOOL_LOGIN])
    writeLocal(r, INSTANCE)
    writeScenario(
      r,
      'cli/fields.yaml',
      scenario({
        id: 'field-vs-variable',
        binds: specBinds('cli/version'),
        needs: ['tool-login'],
        // The scenario PLACES a field where the program reads it — the token is the
        // only route for a name a child process cannot carry.
        setup: { env: { PLACED: '${supplied:tool-login.api-key}' } },
        steps: [
          {
            // `api-key` is not an environment identifier, so nothing the scenario
            // did not ask for lands in its env under that name.
            run: ['env', 'api-key', 'PLACED'],
            expect: { exit: 0, stdout: { equals: 'api-key=(unset)\nPLACED=fake-key\n' } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error(`expected ok, got ${res.status}`)
    const [result] = res.latest.scenarios
    expect(result.failure).toBeUndefined()
    expect(result.outcome).toBe('pass')
  })

  it('exports nothing when the scenario binds nothing — a registration is not ambient', async () => {
    const r = repo()
    writeRecipe(r)
    writeCatalog(r, [TOOL_LOGIN])
    writeLocal(r, INSTANCE)
    writeScenario(
      r,
      'cli/unbound.yaml',
      scenario({
        id: 'binds-nothing',
        binds: specBinds('cli/version'),
        steps: [
          {
            run: ['env', 'TOOL_OAUTH_TOKEN'],
            expect: { exit: 0, stdout: { equals: 'TOOL_OAUTH_TOKEN=(unset)\n' } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error(`expected ok, got ${res.status}`)
    expect(res.latest.scenarios[0].outcome).toBe('pass')
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

// `FIXTURE_BIN` is referenced by `writeRecipe`; keep the import honest.
void FIXTURE_BIN
