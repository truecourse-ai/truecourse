import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSandbox, SandboxError, listSandboxFiles } from '@truecourse/guard-runner'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

function make(opts: Parameters<typeof createSandbox>[0] = {}) {
  const sb = createSandbox(opts)
  cleanups.push(sb.cleanup)
  return sb
}

describe('createSandbox — isolation & env', () => {
  it('redirects HOME into the sandbox, not the real one', () => {
    const sb = make()
    expect(sb.env.HOME).toBeDefined()
    expect(sb.env.HOME).not.toBe(process.env.HOME)
    expect(sb.env.HOME!.startsWith(sb.root)).toBe(true)
    expect(fs.existsSync(sb.env.HOME!)).toBe(true)
  })

  it('points XDG dirs inside the sandbox', () => {
    const sb = make()
    for (const key of ['XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME']) {
      expect(sb.env[key]!.startsWith(sb.root)).toBe(true)
    }
  })

  it('pins the deterministic env vars', () => {
    const sb = make()
    expect(sb.env.TZ).toBe('UTC')
    expect(sb.env.LANG).toBe('C')
    expect(sb.env.NO_COLOR).toBe('1')
    expect(sb.env.COLUMNS).toBe('80')
  })

  it('strips colour-forcing vars that would defeat NO_COLOR', () => {
    process.env.FORCE_COLOR = '3'
    try {
      const sb = make()
      expect(sb.env.FORCE_COLOR).toBeUndefined()
    } finally {
      delete process.env.FORCE_COLOR
    }
  })

  it('lets scenario env win over recipe env', () => {
    const sb = make({ recipeEnv: { APP: 'recipe', SHARED: 'r' }, scenarioEnv: { SHARED: 's' } })
    expect(sb.env.APP).toBe('recipe')
    expect(sb.env.SHARED).toBe('s')
  })
})

describe('createSandbox — env allowlist (hermeticity)', () => {
  it('excludes host vars — secrets, TRUECOURSE_*, and proxy config never reach the child', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-secret'
    process.env.TRUECOURSE_HOME = '/host/.truecourse'
    process.env.HTTPS_PROXY = 'http://proxy:8080'
    process.env.GUARD_RANDOM_HOST_VAR = 'x'
    try {
      const sb = make()
      expect(sb.env.ANTHROPIC_API_KEY).toBeUndefined()
      expect(sb.env.TRUECOURSE_HOME).toBeUndefined()
      expect(sb.env.HTTPS_PROXY).toBeUndefined()
      expect(sb.env.GUARD_RANDOM_HOST_VAR).toBeUndefined()
    } finally {
      delete process.env.ANTHROPIC_API_KEY
      delete process.env.TRUECOURSE_HOME
      delete process.env.HTTPS_PROXY
      delete process.env.GUARD_RANDOM_HOST_VAR
    }
  })

  it('passes PATH through so node/git resolve', () => {
    const sb = make()
    expect(sb.env.PATH).toBe(process.env.PATH)
    expect(sb.env.PATH).toBeTruthy()
  })

  it('points TMPDIR inside the sandbox (temp writes stay hermetic)', () => {
    const sb = make()
    expect(sb.env.TMPDIR).toBeDefined()
    expect(sb.env.TMPDIR!.startsWith(sb.root)).toBe(true)
    expect(fs.existsSync(sb.env.TMPDIR!)).toBe(true)
  })

  it('admits declared recipe.env and setup.env on top of the allowlist', () => {
    const sb = make({ recipeEnv: { RECIPE_VAR: 'r' }, scenarioEnv: { SCENARIO_VAR: 's' } })
    expect(sb.env.RECIPE_VAR).toBe('r')
    expect(sb.env.SCENARIO_VAR).toBe('s')
  })
})

describe('createSandbox — setup.files', () => {
  it('seeds files (including subpaths) into the cwd', () => {
    const sb = make({ setupFiles: { 'config.json': '{"a":1}', 'nested/data.txt': 'hi' } })
    expect(fs.readFileSync(path.join(sb.cwd, 'config.json'), 'utf-8')).toBe('{"a":1}')
    expect(fs.readFileSync(path.join(sb.cwd, 'nested', 'data.txt'), 'utf-8')).toBe('hi')
  })

  it('rejects a path that escapes the sandbox', () => {
    expect(() => make({ setupFiles: { '../escape.txt': 'x' } })).toThrow(SandboxError)
    expect(() => make({ setupFiles: { '/etc/passwd': 'x' } })).toThrow(SandboxError)
  })
})

describe('createSandbox — packageLinks', () => {
  const pkgDirs: string[] = []
  afterEach(() => {
    while (pkgDirs.length) fs.rmSync(pkgDirs.pop()!, { recursive: true, force: true })
  })
  function pkgDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-sbx-pkg-'))
    pkgDirs.push(dir)
    return dir
  }

  it('links a package into node_modules by name', () => {
    const dir = pkgDir()
    const sb = make({ packageLinks: [{ name: 'mypkg', dir }] })
    const link = path.join(sb.cwd, 'node_modules', 'mypkg')
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(dir))
  })

  it('creates the scope parent for a scoped name', () => {
    const dir = pkgDir()
    const sb = make({ packageLinks: [{ name: '@scope/pkg', dir }] })
    const link = path.join(sb.cwd, 'node_modules', '@scope', 'pkg')
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)
  })

  it('never overwrites a path the scenario seeded — the seeded stub wins', () => {
    const dir = pkgDir()
    const sb = make({
      setupFiles: { 'node_modules/mypkg/index.js': 'module.exports = "stub"' },
      packageLinks: [{ name: 'mypkg', dir }],
    })
    const target = path.join(sb.cwd, 'node_modules', 'mypkg')
    expect(fs.lstatSync(target).isSymbolicLink()).toBe(false)
    expect(fs.readFileSync(path.join(target, 'index.js'), 'utf-8')).toBe('module.exports = "stub"')
  })

  it('rejects a link name that escapes node_modules', () => {
    const dir = pkgDir()
    expect(() => make({ packageLinks: [{ name: '../evil', dir }] })).toThrow(SandboxError)
  })
})

describe('cleanup & listing', () => {
  it('lists sandbox files sorted, then cleanup removes the root', () => {
    const sb = createSandbox({ setupFiles: { 'b.txt': '1', 'a/c.txt': '2' } })
    expect(listSandboxFiles(sb.cwd)).toEqual(['a/c.txt', 'b.txt'])
    sb.cleanup()
    expect(fs.existsSync(sb.root)).toBe(false)
  })
})
