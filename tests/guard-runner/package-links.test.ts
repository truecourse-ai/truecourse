import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { discoverPackageLinks } from '@truecourse/guard-runner'
import { rmrf } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-pkg-links-'))
  repos.push(dir)
  return dir
}

function writePkg(dir: string, pkg: Record<string, unknown>): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg))
}

describe('discoverPackageLinks — root package', () => {
  it('links a single-package repo by its name', () => {
    const r = repo()
    writePkg(r, { name: 'tsx', version: '1.0.0' })
    expect(discoverPackageLinks(r)).toEqual([{ name: 'tsx', dir: r }])
  })

  it('links a scoped root name', () => {
    const r = repo()
    writePkg(r, { name: '@scope/pkg' })
    expect(discoverPackageLinks(r)).toEqual([{ name: '@scope/pkg', dir: r }])
  })

  it('returns nothing for a repo without package.json (non-Node target)', () => {
    expect(discoverPackageLinks(repo())).toEqual([])
  })

  it('skips a package.json without a name, and invalid JSON', () => {
    const unnamed = repo()
    writePkg(unnamed, { private: true })
    expect(discoverPackageLinks(unnamed)).toEqual([])

    const broken = repo()
    fs.writeFileSync(path.join(broken, 'package.json'), '{ not json')
    expect(discoverPackageLinks(broken)).toEqual([])
  })

  it('rejects names that would escape node_modules', () => {
    for (const name of ['../evil', '/abs', 'a/b/c', '@scope/..', 'plain/other']) {
      const r = repo()
      writePkg(r, { name })
      expect(discoverPackageLinks(r)).toEqual([])
    }
  })
})

describe('discoverPackageLinks — workspaces', () => {
  it('expands npm/yarn `workspaces` array globs', () => {
    const r = repo()
    writePkg(r, { name: 'root', workspaces: ['packages/*'] })
    writePkg(path.join(r, 'packages', 'a'), { name: '@acme/a' })
    writePkg(path.join(r, 'packages', 'b'), { name: '@acme/b' })
    // A workspace dir without a package.json is not a package.
    fs.mkdirSync(path.join(r, 'packages', 'empty'), { recursive: true })

    expect(discoverPackageLinks(r)).toEqual([
      { name: 'root', dir: r },
      { name: '@acme/a', dir: path.join(r, 'packages', 'a') },
      { name: '@acme/b', dir: path.join(r, 'packages', 'b') },
    ])
  })

  it('supports the `workspaces.packages` object form', () => {
    const r = repo()
    writePkg(r, { name: 'root', workspaces: { packages: ['libs/*'] } })
    writePkg(path.join(r, 'libs', 'x'), { name: 'x' })
    expect(discoverPackageLinks(r)).toContainEqual({ name: 'x', dir: path.join(r, 'libs', 'x') })
  })

  it('reads pnpm-workspace.yaml, honoring `!` exclusions', () => {
    const r = repo()
    writePkg(r, { name: 'root' })
    fs.writeFileSync(
      path.join(r, 'pnpm-workspace.yaml'),
      "packages:\n  - 'packages/*'\n  - '!packages/skipme'\n",
    )
    writePkg(path.join(r, 'packages', 'keep'), { name: 'keep' })
    writePkg(path.join(r, 'packages', 'skipme'), { name: 'skipme' })

    const links = discoverPackageLinks(r)
    expect(links).toContainEqual({ name: 'keep', dir: path.join(r, 'packages', 'keep') })
    expect(links.map((l) => l.name)).not.toContain('skipme')
  })

  it('expands `**` patterns without descending into node_modules or dot-dirs', () => {
    const r = repo()
    writePkg(r, { name: 'root', workspaces: ['packages/**'] })
    writePkg(path.join(r, 'packages', 'group', 'deep'), { name: 'deep' })
    writePkg(path.join(r, 'packages', 'node_modules', 'trap'), { name: 'trap' })
    writePkg(path.join(r, 'packages', '.hidden', 'trap2'), { name: 'trap2' })

    const names = discoverPackageLinks(r).map((l) => l.name)
    expect(names).toContain('deep')
    expect(names).not.toContain('trap')
    expect(names).not.toContain('trap2')
  })

  it('dedupes by name — first discovery wins', () => {
    const r = repo()
    writePkg(r, { name: 'dup', workspaces: ['packages/*'] })
    writePkg(path.join(r, 'packages', 'a'), { name: 'dup' })
    expect(discoverPackageLinks(r)).toEqual([{ name: 'dup', dir: r }])
  })

  it('a malformed pnpm-workspace.yaml yields no workspace links, not a crash', () => {
    const r = repo()
    writePkg(r, { name: 'root' })
    fs.writeFileSync(path.join(r, 'pnpm-workspace.yaml'), 'packages: [unclosed')
    expect(discoverPackageLinks(r)).toEqual([{ name: 'root', dir: r }])
  })
})
