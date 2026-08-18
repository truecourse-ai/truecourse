/**
 * THE FINDINGS LEDGER — `guard/interfaces.findings.md`, the doc-bug feed
 * (item 13). What is under test is the property the file exists for: it
 * ACCUMULATES. A run adds its section and touches nothing above it, so the
 * answer to "has anybody fixed this doc" is the file's own history rather than
 * whatever the last run happened to see.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { guardInterfaceFindingsPath } from '@truecourse/guard-runner'
import { appendInterfaceFindings } from '../../packages/interface-author/src/findings'

let repo: string

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-iface-findings-'))
})

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true })
})

const read = (): string => fs.readFileSync(guardInterfaceFindingsPath(repo), 'utf-8')

describe('appending a run', () => {
  it('writes one section under the run id, one bullet per finding, tagged with its place', () => {
    const result = appendInterfaceFindings({
      repoRoot: repo,
      runId: '2026-08-18T00-00-00Z_abc123',
      now: () => '2026-08-18T00:10:00.000Z',
      findings: [
        { placeId: 'root', note: 'docs/overview.mdx says the home grid has an "Export" button; src/Home.tsx renders none' },
        { placeId: 'settings', note: 'the briefing joins GET /api/keys to `api/get-api-keys`; src/Settings.tsx calls trpc.apiToken.list' },
      ],
    })

    expect(result).toEqual({ path: guardInterfaceFindingsPath(repo), appended: 2 })
    const text = read()
    expect(text).toContain('## 2026-08-18T00-00-00Z_abc123 (2026-08-18T00:10:00.000Z)')
    expect(text).toContain(
      '- `root` — docs/overview.mdx says the home grid has an "Export" button; src/Home.tsx renders none',
    )
    expect(text).toContain('- `settings` — the briefing joins GET /api/keys')
    // The preamble says what a reader is looking at — a committed file nobody
    // ran the command for still has to explain itself.
    expect(text.startsWith('# Interface authoring — findings')).toBe(true)
  })

  it('writes nothing at all when the run found none', () => {
    expect(
      appendInterfaceFindings({ repoRoot: repo, runId: 'r1', findings: [] }),
    ).toBeUndefined()
    expect(fs.existsSync(guardInterfaceFindingsPath(repo))).toBe(false)
  })

  /**
   * Two places that read the same doc report the same doc bug. One bullet is the
   * honest count of it — the duplicate says nothing the first line did not.
   */
  it('collapses the same discrepancy reported by two places, keeping the first', () => {
    const result = appendInterfaceFindings({
      repoRoot: repo,
      runId: 'r1',
      findings: [
        { placeId: 'root', note: 'README.md documents a /export address the router never declares' },
        { placeId: 'settings', note: 'README.md documents a /export address the router never declares' },
        { placeId: 'settings', note: 'CONTRIBUTING.md names a "Preview" tab src/Settings.tsx does not render' },
      ],
    })
    expect(result!.appended).toBe(2)
    const bullets = read().split('\n').filter((line) => line.startsWith('- '))
    expect(bullets).toEqual([
      '- `root` — README.md documents a /export address the router never declares',
      '- `settings` — CONTRIBUTING.md names a "Preview" tab src/Settings.tsx does not render',
    ])
  })
})

describe('a second run', () => {
  it('appends below the first — the history is the point, so nothing is rewritten', () => {
    appendInterfaceFindings({
      repoRoot: repo,
      runId: 'run-one',
      now: () => '2026-08-18T00:00:00.000Z',
      findings: [{ placeId: 'root', note: 'docs say "Export"; the source has none' }],
    })
    appendInterfaceFindings({
      repoRoot: repo,
      runId: 'run-two',
      now: () => '2026-08-19T00:00:00.000Z',
      // The SAME finding, a day later: still unfixed, and the ledger says so
      // twice. Dedupe is within a run only.
      findings: [{ placeId: 'root', note: 'docs say "Export"; the source has none' }],
    })

    const text = read()
    expect(text.indexOf('## run-one')).toBeLessThan(text.indexOf('## run-two'))
    expect(text.split('- `root` — docs say "Export"; the source has none')).toHaveLength(3)
    // One preamble, however many runs.
    expect(text.split('# Interface authoring — findings')).toHaveLength(2)
  })
})
