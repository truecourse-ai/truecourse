import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  collectDiscoveryInputs,
  buildRecipeUserPrompt,
  discoverRecipe,
  type RecipeRunner,
} from '@truecourse/guard-generator'

const repos: string[] = []
afterEach(() => {
  while (repos.length) fs.rmSync(repos.pop()!, { recursive: true, force: true })
})

/** A bare repo root with NO manifest of any ecosystem. */
function bareRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-recipe-disc-'))
  repos.push(dir)
  return dir
}

function write(repo: string, rel: string, content: string): void {
  const target = path.join(repo, rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

/** sqlfluff-shaped pyproject: [project.scripts] names the exact CLI entry point. */
const PYPROJECT = [
  '[project]',
  'name = "sqlfluff"',
  'version = "3.0.0"',
  '',
  '[project.scripts]',
  'sqlfluff = "sqlfluff.cli.commands:cli"',
  '',
  '[build-system]',
  'requires = ["setuptools>=61.0"]',
  'build-backend = "setuptools.build_meta"',
].join('\n')

/** A .NET console tool project: OutputType Exe + a dotnet-tool command name. */
const CSPROJ = [
  '<Project Sdk="Microsoft.NET.Sdk">',
  '  <PropertyGroup>',
  '    <OutputType>Exe</OutputType>',
  '    <TargetFramework>net8.0</TargetFramework>',
  '    <ToolCommandName>mytool</ToolCommandName>',
  '    <PackAsTool>true</PackAsTool>',
  '  </PropertyGroup>',
  '</Project>',
].join('\n')

/** A docs-site package.json — present, but NOT the program under test. */
const DOCS_PACKAGE_JSON = JSON.stringify(
  { name: 'sqlfluff-docs', version: '1.0.0', scripts: { build: 'vite build' }, devDependencies: { vite: '^5.0.0' } },
  null,
  2,
)

describe('collectDiscoveryInputs — ecosystem-aware inputs', () => {
  it('a Python repo surfaces the console-script entry, with no "(no package.json)" degradation', () => {
    const r = bareRepo()
    write(r, 'pyproject.toml', PYPROJECT)
    write(r, 'requirements.txt', 'sqlparse\n')

    const inputs = collectDiscoveryInputs(r)
    const py = inputs.manifests.find((m) => m.path === 'pyproject.toml')
    expect(py?.ecosystem).toBe('python')
    expect(py?.content).toContain('sqlfluff.cli.commands:cli')

    const prompt = buildRecipeUserPrompt(inputs)
    expect(prompt).toContain('[python] pyproject.toml')
    expect(prompt).toContain('sqlfluff.cli.commands:cli')
    expect(prompt).not.toContain('(no package.json)')
  })

  it('a C# repo surfaces OutputType and ToolCommandName from the discovered csproj', () => {
    const r = bareRepo()
    write(r, 'global.json', JSON.stringify({ sdk: { version: '8.0.100' } }))
    write(r, path.join('src', 'Tool', 'Tool.csproj'), CSPROJ)

    const inputs = collectDiscoveryInputs(r)
    const cs = inputs.manifests.find((m) => m.path.endsWith('Tool.csproj'))
    expect(cs?.ecosystem).toBe('csharp')
    expect(cs?.content).toContain('<OutputType>Exe</OutputType>')
    expect(cs?.content).toContain('<ToolCommandName>mytool</ToolCommandName>')

    const prompt = buildRecipeUserPrompt(inputs)
    expect(prompt).toContain('[csharp] global.json')
    expect(prompt).toContain('<OutputType>Exe</OutputType>')
    expect(prompt).toContain('<ToolCommandName>mytool</ToolCommandName>')
  })

  it('a repo with a real Python CLI AND a docs-site package.json includes both, labeled', () => {
    const r = bareRepo()
    write(r, 'pyproject.toml', PYPROJECT)
    write(r, 'package.json', DOCS_PACKAGE_JSON)

    const inputs = collectDiscoveryInputs(r)
    const ecosystems = inputs.manifests.map((m) => `${m.ecosystem}:${m.path}`)
    expect(ecosystems).toContain('js:package.json')
    expect(ecosystems).toContain('python:pyproject.toml')

    const prompt = buildRecipeUserPrompt(inputs)
    expect(prompt).toContain('[js] package.json')
    expect(prompt).toContain('[python] pyproject.toml')
    // The instruction to pick by declared CLI, not fixed precedence, is on the system prompt;
    // both manifests reach the model side by side so it can choose.
    expect(prompt).toContain('sqlfluff.cli.commands:cli')
    expect(prompt).toContain('sqlfluff-docs')
  })

  it('caps the number of inlined C# project files and names the overflow', () => {
    const r = bareRepo()
    // Eight projects with increasing size so the ranking + cap are observable.
    for (let i = 0; i < 8; i++) {
      write(r, path.join('src', `P${i}`, `P${i}.csproj`), CSPROJ + '\n' + '<!-- pad -->'.repeat(i * 50))
    }
    const inputs = collectDiscoveryInputs(r)
    const inlined = inputs.manifests.filter((m) => m.ecosystem === 'csharp')
    expect(inlined).toHaveLength(6)
    expect(inputs.extraProjectNote).toMatch(/2 more C# project file\(s\) present, not inlined/)
    expect(buildRecipeUserPrompt(inputs)).toContain('2 more C# project file(s) present, not inlined')
  })

  it('caps oversized manifest contents with a truncation marker', () => {
    const r = bareRepo()
    write(r, 'requirements.txt', 'a==1.0\n'.repeat(3000))
    const inputs = collectDiscoveryInputs(r)
    const req = inputs.manifests.find((m) => m.path === 'requirements.txt')
    expect(req?.content.endsWith('…(truncated)')).toBe(true)
  })
})

describe('discoverRecipe — fail loudly + no-op belt + ambiguity', () => {
  it('a manifest-less repo fails loudly WITHOUT calling the model', async () => {
    const r = bareRepo()
    let called = false
    const runner: RecipeRunner = async () => {
      called = true
      return { build: 'true', entry: ['node', 'x.js'] }
    }
    const res = await discoverRecipe(r, runner)
    expect(res.status).toBe('verify-failed')
    if (res.status === 'verify-failed') {
      expect(res.reason).toContain('no JS/TS, Python, or C# manifest found')
      expect(res.reason).toContain('write .truecourse/scenarios/recipe.json by hand')
    }
    expect(called).toBe(false)
  })

  it('rejects a no-op entry proposal before the build runs', async () => {
    const r = bareRepo()
    write(r, 'package.json', JSON.stringify({ name: 'x', version: '0.0.0', bin: { x: 'cli.js' } }))
    let buildAttempted = false
    const runner: RecipeRunner = async () => {
      // If a build ever ran this would be a real spawn; instead the belt stops it.
      buildAttempted = true
      return { build: 'true', entry: ['true'] }
    }
    const res = await discoverRecipe(r, runner)
    expect(res.status).toBe('verify-failed')
    if (res.status === 'verify-failed') {
      expect(res.reason).toContain('program under test')
      expect(res.reason).toContain('shell no-op')
    }
    // The runner WAS called (it proposed), but no build was spawned — belt first.
    expect(buildAttempted).toBe(true)
  })

  it('surfaces an ambiguous reply as a discovery failure without a re-ask', async () => {
    const r = bareRepo()
    write(r, 'pyproject.toml', PYPROJECT)
    write(r, 'package.json', DOCS_PACKAGE_JSON)
    let calls = 0
    const runner: RecipeRunner = async () => {
      calls++
      return { ambiguous: 'a Python CLI and a Node docs build both declare entry points; unclear which is under test' }
    }
    const res = await discoverRecipe(r, runner)
    expect(res.status).toBe('verify-failed')
    if (res.status === 'verify-failed') {
      expect(res.reason).toContain('recipe discovery ambiguous')
      expect(res.reason).toContain('unclear which is under test')
    }
    expect(calls).toBe(1) // ambiguity is deliberate, never re-asked
  })
})

describe('verification-failure revision', () => {
  /** A JS repo whose package.json declares a bin the fixture provides directly. */
  function jsRepo(): string {
    const repo = bareRepo()
    write(
      repo,
      'package.json',
      JSON.stringify({ name: 'fix', version: '1.0.0', bin: { fix: 'cli.mjs' } }, null, 2),
    )
    write(repo, 'cli.mjs', 'console.log("ok")\n')
    return repo
  }

  it('hands the engine failure back once and accepts a revised proposal that verifies', async () => {
    const repo = jsRepo()
    const calls: unknown[] = []
    const runner: RecipeRunner = async (input) => {
      calls.push(input)
      // First call proposes an install that fails (npm ci without a lockfile);
      // the revision drops it.
      if (calls.length === 1) return { install: 'false', build: 'true', entry: ['node', 'cli.mjs'] }
      return { build: 'true', entry: ['node', 'cli.mjs'] }
    }

    const res = await discoverRecipe(repo, runner)
    expect(res.status).toBe('discovered')
    if (res.status !== 'discovered') return
    expect(res.recipe.install).toBeUndefined()

    expect(calls).toHaveLength(2)
    const revision = calls[1] as { verifyFailure?: { proposal: string; reason: string } }
    expect(revision.verifyFailure).toBeDefined()
    expect(revision.verifyFailure!.proposal).toContain('"install":"false"')
    expect(revision.verifyFailure!.reason).toContain('install `false` failed')
  })

  it('reports the REVISED proposal failure when the revision also dies', async () => {
    const repo = jsRepo()
    let n = 0
    const runner: RecipeRunner = async () => {
      n++
      return n === 1
        ? { install: 'false', build: 'true', entry: ['node', 'cli.mjs'] }
        : { install: 'false --again', build: 'true', entry: ['node', 'cli.mjs'] }
    }

    const res = await discoverRecipe(repo, runner)
    expect(res.status).toBe('verify-failed')
    if (res.status !== 'verify-failed') return
    expect(res.reason).toContain('install `false --again` failed')
    expect(n).toBe(2)
  })

  it('renders the verification-failure block in the prompt', () => {
    const prompt = buildRecipeUserPrompt({
      manifests: [{ path: 'package.json', ecosystem: 'js', content: '{}' }],
      presentInputs: [],
      verifyFailure: { proposal: '{"build":"npm ci"}', reason: 'install `npm ci` failed: no lockfile' },
    })
    expect(prompt).toContain('VERIFICATION FAILURE')
    expect(prompt).toContain('install `npm ci` failed: no lockfile')
    expect(prompt).toContain('Revise the recipe')
    expect(prompt).toContain('OMITTING install')
  })
})

describe('workspace member manifests', () => {
  it('surfaces bin-declaring workspace members from pnpm-workspace globs', () => {
    const repo = bareRepo()
    write(repo, 'package.json', JSON.stringify({ name: 'mono', private: true, version: '0.0.0' }, null, 2))
    write(repo, 'pnpm-workspace.yaml', 'packages:\n  - "@commitlint/*"\n')
    write(
      repo,
      '@commitlint/cli/package.json',
      JSON.stringify({ name: '@commitlint/cli', version: '1.0.0', bin: { commitlint: 'cli.js' } }, null, 2),
    )
    write(
      repo,
      '@commitlint/load/package.json',
      JSON.stringify({ name: '@commitlint/load', version: '1.0.0' }, null, 2),
    )

    const inputs = collectDiscoveryInputs(repo)
    const paths = inputs.manifests.map((m) => m.path)
    expect(paths).toContain('@commitlint/cli/package.json')
    expect(paths).not.toContain('@commitlint/load/package.json')
  })

  it('surfaces members from a root package.json workspaces array', () => {
    const repo = bareRepo()
    write(
      repo,
      'package.json',
      JSON.stringify({ name: 'mono', private: true, version: '0.0.0', workspaces: ['packages/*'] }, null, 2),
    )
    write(
      repo,
      'packages/tool/package.json',
      JSON.stringify({ name: 'tool', version: '1.0.0', bin: { tool: 'index.js' } }, null, 2),
    )

    const inputs = collectDiscoveryInputs(repo)
    expect(inputs.manifests.map((m) => m.path)).toContain('packages/tool/package.json')
  })
})
