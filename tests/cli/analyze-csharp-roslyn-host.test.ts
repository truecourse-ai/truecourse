import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'

// Same socket stub as analyze-csharp.test.ts — emits require a live socket server.
vi.mock('../../apps/dashboard/server/src/socket/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/dashboard/server/src/socket/handlers')>()
  class NoopTracker {
    start() {}
    done() {}
    error() {}
    detail() {}
  }
  return {
    ...actual,
    emitAnalysisProgress: vi.fn(),
    emitAnalysisComplete: vi.fn(),
    emitViolationsReady: vi.fn(),
    emitFilesChanged: vi.fn(),
    emitAnalysisCanceled: vi.fn(),
    createSocketTracker: () => new NoopTracker(),
    createSocketLlmEstimateHandler: () => () => Promise.resolve(true),
  }
})

import { analyzeInProcess } from '../../packages/core/src/commands/analyze-in-process'
import { readLatest, clearLatestCache } from '../../packages/core/src/lib/analysis-store'
import { registerProject, unregisterProject, type RegistryEntry } from '../../packages/core/src/config/registry'
import { updateProjectConfig } from '../../packages/core/src/config/project-config'
import { resolveRoslynHostBinary } from '../../packages/analyzer/src/roslyn-host-client'

const HOST_KEY = 'bugs/deterministic/referenceequals-on-value-type'
const hostBuilt = resolveRoslynHostBinary() !== null

const PROJECT = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>
`
// Value-type ReferenceEquals — only the semantic (Roslyn) engine can catch this.
const SOURCE = `namespace Demo;

public class IdentityChecks
{
    public bool SameValue(int a, int b) => object.ReferenceEquals(a, b);

    public bool SameRef(object a, object b) => object.ReferenceEquals(a, b);
}
`

describe.skipIf(!hostBuilt)('CLI analyze e2e — Roslyn host violations reach the store', () => {
  let workDir: string
  let project: RegistryEntry

  beforeAll(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-e2e-roslyn-'))
    fs.writeFileSync(path.join(workDir, 'Demo.csproj'), PROJECT)
    fs.writeFileSync(path.join(workDir, 'IdentityChecks.cs'), SOURCE)
    const env = { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 't@t' }
    execSync('git init -q -b main', { cwd: workDir, env })
    execSync('git add -A', { cwd: workDir, env })
    execSync('git -c commit.gpgsign=false commit -q -m init', { cwd: workDir, env })
    project = await registerProject(workDir)
    await updateProjectConfig(workDir, { enableLlmRules: false })
    clearLatestCache()
  }, 30_000)

  afterAll(async () => {
    if (project) await unregisterProject(project.slug)
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true })
    clearLatestCache()
  })

  it('flags ReferenceEquals on a value type via the semantic host (once)', async () => {
    const result = await analyzeInProcess(project, { enableLlmRulesOverride: false })
    expect(result.analysisId).toBeTruthy()

    const latest = await readLatest(workDir)
    expect(latest).not.toBeNull()

    const hostHits = latest!.violations.filter((v) => v.ruleKey === HOST_KEY)
    expect(hostHits.length).toBe(1)
    expect(hostHits[0].filePath).toMatch(/IdentityChecks\.cs$/)
    expect(hostHits[0].severity).toBe('high')
    expect(hostHits[0].title).toBe('ReferenceEquals on a value type')
    expect(hostHits[0].lineStart).toBeGreaterThan(0)
  }, 180_000)
})
