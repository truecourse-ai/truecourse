/**
 * One-off diagnostic — runs suggest + accept + analyze on the negative
 * fixture and dumps violations + markers to /tmp for inspection. Skipped
 * unless `INSPECT=1` is set (so it doesn't run in normal test sweeps).
 *
 * Usage: `INSPECT=1 LLM_TESTS=1 pnpm test tests/_inspect/`
 */
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

vi.mock('../../apps/dashboard/server/src/socket/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/dashboard/server/src/socket/handlers')>()
  class NoopTracker { start() {} done() {} error() {} detail() {} }
  return {
    ...actual,
    emitAnalysisProgress: vi.fn(),
    emitAnalysisComplete: vi.fn(),
    emitViolationsReady: vi.fn(),
    emitAnalysisCanceled: vi.fn(),
    createSocketTracker: () => new NoopTracker(),
    createSocketLlmEstimateHandler: () => () => Promise.resolve(true),
  }
})

import { analyzeInProcess } from '../../packages/core/src/commands/analyze-in-process'
import { readLatest, clearLatestCache } from '../../packages/core/src/lib/analysis-store'
import { registerProject, unregisterProject } from '../../packages/core/src/config/registry'
import { updateProjectConfig } from '../../packages/core/src/config/project-config'
import {
  suggestInvariants,
  acceptDraft,
} from '../../packages/core/src/services/invariants'
import { createLLMProvider } from '../../packages/core/src/services/llm/provider'
import { readAllActiveInvariants } from '../../packages/core/src/lib/invariant-store'
import { parseInvariantDriftMarkers } from '../_shared/markers'

const INSPECT = process.env.INSPECT === '1'
const LLM_TESTS = process.env.LLM_TESTS === '1'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.resolve(__dirname, '../fixtures/sample-js-project-negative')

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '.truecourse' || entry.name === 'node_modules' || entry.name === '.git') continue
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

describe.skipIf(!INSPECT || !LLM_TESTS)('inspect: negative fixture violations vs markers', () => {
  it('runs suggest + accept + analyze and dumps results', async () => {
    const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-inspect-'))
    copyDir(FIXTURE, wd)
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 't@t',
    }
    execSync('git init -q -b main', { cwd: wd, env })
    execSync('git add -A', { cwd: wd, env })
    execSync('git -c commit.gpgsign=false commit -q -m init', { cwd: wd, env })

    const project = registerProject(wd)
    updateProjectConfig(wd, { enableLlmRules: false })
    clearLatestCache()

    const llm = createLLMProvider()
    llm.setRepoPath(wd)

    console.log('\n[inspect] running suggestInvariants…')
    const suggestion = await suggestInvariants({ repoPath: wd, mode: 'full', llm })
    console.log(`[inspect] suggest produced ${suggestion.drafts.length} drafts`)

    for (const draft of suggestion.drafts) acceptDraft(wd, draft.id)

    console.log('[inspect] running analyzeInProcess…')
    await analyzeInProcess(project, { enableLlmRulesOverride: false })
    const violations = readLatest(wd)!.violations
    const inv = violations.filter((v) => v.type === 'invariant')
    console.log(`[inspect] analyze produced ${inv.length} invariant violations`)

    const markers = parseInvariantDriftMarkers(wd)
    console.log(`[inspect] fixture has ${markers.length} INVARIANT-DRIFT markers`)

    const activeInvariants = readAllActiveInvariants(wd)
    const idToKey = new Map<string, string>()
    for (const i of activeInvariants) {
      const decl = i.declaration as { obligationKey?: string }
      if (decl.obligationKey) idToKey.set(i.id, decl.obligationKey)
    }

    const byFile = new Map<string, typeof inv>()
    for (const v of inv) {
      const f = v.filePath ?? '(no-file)'
      if (!byFile.has(f)) byFile.set(f, [])
      byFile.get(f)!.push(v)
    }

    console.log('\n=== Violations grouped by file (with obligationKey) ===')
    for (const [file, vs] of [...byFile.entries()].sort()) {
      console.log(`\n${file}  (${vs.length} violations)`)
      const fileMarkers = markers.filter((m) => path.relative(wd, m.filePath) === file)
      console.log(`  Markers in this file: ${fileMarkers.length}`)
      for (const m of fileMarkers) {
        console.log(`    L${m.line} — ${m.obligationKey}`)
      }
      console.log(`  Violations:`)
      for (const v of vs.sort((a, b) => (a.lineStart ?? 0) - (b.lineStart ?? 0))) {
        const idMatch = v.ruleKey ? /^invariants\/[^/]+\/(.+)$/.exec(v.ruleKey) : null
        const id = idMatch ? idMatch[1] : undefined
        const key = id ? idToKey.get(id) ?? '?' : '?'
        console.log(`    L${v.lineStart}-${v.lineEnd}  key="${key}"  ${v.content}`)
      }
    }

    fs.writeFileSync(
      '/tmp/inspect-negative-violations.json',
      JSON.stringify(inv.map((v) => ({
        ...v,
        obligationKey: v.invariantId ? idToKey.get(v.invariantId) : undefined,
      })), null, 2),
    )
    fs.writeFileSync('/tmp/inspect-negative-markers.json', JSON.stringify(markers, null, 2))
    fs.writeFileSync('/tmp/inspect-negative-workdir.txt', wd)
    console.log(`\n[inspect] saved violations + markers JSON to /tmp/`)
    console.log(`[inspect] workdir kept at ${wd} for poking around`)

    unregisterProject(project.slug)
    expect(inv.length).toBeGreaterThan(0)
  }, 30 * 60 * 1000)
})
