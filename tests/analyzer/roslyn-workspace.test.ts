import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  runRoslynWorkspace,
  resolveRoslynHostBinary,
  RoslynHostUnavailableError,
} from '../../packages/analyzer/src/roslyn-host-client'

// These open a REAL .csproj via MSBuildWorkspace, so they need both the built
// host and a .NET SDK on PATH (to restore the project). Skip otherwise.
const hostBuilt = resolveRoslynHostBinary() !== null
function dotnetAvailable(): boolean {
  try {
    execFileSync('dotnet', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const canRun = hostBuilt && dotnetAvailable()

const NS_RULE = 'architecture/deterministic/namespace-folder-mismatch'

describe.skipIf(!canRun)('Roslyn workspace client (project-aware C#)', () => {
  let dir: string
  let csproj: string

  beforeAll(() => {
    // A small but realistic library: a domain folder whose types should live in
    // a matching namespace. One file follows the convention, one ignores it.
    dir = mkdtempSync(join(tmpdir(), 'tc-roslyn-ws-'))
    csproj = join(dir, 'Shop.csproj')
    writeFileSync(
      csproj,
      `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Library</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <RootNamespace>Acme.Shop</RootNamespace>
    <Nullable>enable</Nullable>
  </PropertyGroup>
</Project>
`,
    )
    mkdirSync(join(dir, 'Orders'))
    // Correct: file in Orders/, namespace ends with .Orders — must NOT be flagged.
    writeFileSync(
      join(dir, 'Orders', 'Order.cs'),
      `namespace Acme.Shop.Orders;

public sealed class Order
{
    public int Id { get; init; }
    public decimal Total { get; init; }
}
`,
    )
    // Wrong: file in Orders/ but the namespace ignores the folder — must be flagged.
    writeFileSync(
      join(dir, 'Orders', 'OrderRepository.cs'),
      `namespace Acme.Shop.Data;

public sealed class OrderRepository
{
    public Order? Find(int id) => null;
}
`,
    )
    execFileSync('dotnet', ['restore', csproj], { stdio: 'ignore' })
  }, 120_000)

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('flags a namespace that ignores its folder — needs the real project (RootNamespace + path)', async () => {
    const violations = await runRoslynWorkspace(csproj, [NS_RULE])
    const flagged = violations.filter((v) => v.ruleKey === NS_RULE)
    expect(flagged).toHaveLength(1)
    expect(flagged[0].path).toContain('OrderRepository.cs')
    expect(flagged[0].line).toBe(1)
  }, 60_000)

  it('does not flag a correctly-placed namespace (no false positive on a custom root)', async () => {
    const violations = await runRoslynWorkspace(csproj, [NS_RULE])
    expect(violations.some((v) => v.path.includes('Order.cs') && !v.path.includes('OrderRepository'))).toBe(false)
  }, 60_000)
})

describe('Roslyn workspace client — fail-hard when unavailable', () => {
  it('rejects with a clear error when the host binary is missing (no fallback)', async () => {
    const prev = process.env.TRUECOURSE_ROSLYN_HOST
    process.env.TRUECOURSE_ROSLYN_HOST = '/nonexistent/roslyn-host'
    try {
      await expect(runRoslynWorkspace('/tmp/whatever.csproj')).rejects.toBeInstanceOf(RoslynHostUnavailableError)
    } finally {
      if (prev === undefined) delete process.env.TRUECOURSE_ROSLYN_HOST
      else process.env.TRUECOURSE_ROSLYN_HOST = prev
    }
  })
})
