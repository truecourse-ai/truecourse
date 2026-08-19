/**
 * THE FINDINGS REPORT (plan 05 step 24) — `guard/findings.md`, the pure render
 * of the board's `bug` / `drift` verdicts.
 *
 * Two properties earn the file its own module. NUMBERING IS STABLE: `F7` in an
 * old conversation must still name the same bug after a re-render, so the
 * first-seen registry is persisted in the report itself and only ever grows.
 * And the DOC QUOTE IS HONEST: it is resolved live from the scenario's bind, so
 * a section edited since the scenario bound it says so instead of quoting text
 * the verdict never read.
 *
 * The report is regenerated WHOLE each `--report`; its sibling
 * `guard/adjudicate.findings.md` is the opposite — an append-only per-run
 * ledger. Both are committable, and that is asserted against the real gitignore
 * template rather than trusted.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildDocSectionIndex,
  guardAdjudicateFindingsPath,
  guardFindingsReportPath,
  writeGuardLatest,
} from '@truecourse/guard-runner'
import type {
  GuardAdjudicationClass,
  GuardLatest,
  GuardScenarioAdjudication,
  GuardScenarioResult,
} from '@truecourse/shared'
import {
  parseFindingNumbering,
  renderGuardFindingsReport,
  writeGuardFindingsReport,
} from '../../packages/core/src/services/guard-adjudicate/findings-report'
import { appendFindingsLedger } from '../../packages/core/src/services/agent/findings-ledger'
import { writeGuardAdjudicationReport } from '../../packages/core/src/commands/guard-adjudicate'
import { ensureRepoTruecourseDir } from '../../packages/core/src/config/paths'

let repo: string

const DOC = 'docs/cli.md'
const DOC_CONTENT = [
  '# CLI',
  '',
  'The relkit command line.',
  '',
  '## verbose',
  '',
  '`relkit --verbose` prints the resolved config and exits 0.',
  '',
].join('\n')

/** The live anchor + fingerprint of the doc's `verbose` section. */
function bind(content = DOC_CONTENT): { doc: string; section: string; fingerprint: string } {
  const index = buildDocSectionIndex(DOC, content)
  const section = index.sections.find((s) => s.headingText === 'verbose')
  if (!section) throw new Error('fixture doc has no `verbose` section')
  return { doc: DOC, section: section.anchor, fingerprint: section.fingerprint }
}

function writeDoc(content: string): void {
  const target = path.join(repo, DOC)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-findings-report-'))
  writeDoc(DOC_CONTENT)
})
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true })
})

function verdict(cls: GuardAdjudicationClass, over: Partial<GuardScenarioAdjudication> = {}): GuardScenarioAdjudication {
  return {
    class: cls,
    mechanism: 'the flag parser drops the last token',
    ...(cls === 'bug' ? { code: { file: 'src/cli.ts', line: 42 } } : {}),
    evidence: ['exit 2 — unknown flag'],
    confidence: 'high',
    findings: [],
    adjudicatedAt: '2026-02-01T00:00:00.000Z',
    ...over,
  }
}

function row(id: string, adjudication?: GuardScenarioAdjudication): GuardScenarioResult {
  return {
    id,
    title: `${id} title`,
    binds: bind(),
    outcome: 'fail',
    durationMs: 1,
    failure: { step: 2, expected: 'exit 0', actual: 'exit 2 — unknown flag' },
    flowId: 'flow-1',
    ...(adjudication ? { adjudication } : {}),
  }
}

/** A board holding `rows` in board order (sorted by id, as `mergeGuardBoard` leaves it). */
function board(rows: GuardScenarioResult[]): GuardLatest {
  const scenarios = [...rows].sort((a, b) => a.id.localeCompare(b.id))
  return {
    run: {
      runId: 'r1',
      ranAt: '2026-01-01T00:00:00.000Z',
      branch: 'main',
      commit: 'deadbeef',
      recipeFingerprint: 'sha256:r',
    },
    summary: { total: scenarios.length, pass: 0, fail: scenarios.length, stale: 0, orphaned: 0, error: 0, blocked: 0 },
    scenarios,
    sections: [],
  }
}

const render = (latest: GuardLatest | null, prior: string | null) =>
  renderGuardFindingsReport({ repoRoot: repo, latest, prior, now: () => '2026-02-01T00:00:00.000Z' })

const headings = (content: string): string[] => content.match(/^## F\d+ — .*$/gm) ?? []

describe('finding numbering — stable by first-seen order, never reused', () => {
  it('numbers in board order and persists the registry in the file', () => {
    const first = render(board([row('scn-b', verdict('bug')), row('scn-a', verdict('bug'))]), null)!
    expect(first.findings).toBe(2)
    expect(headings(first.content)).toEqual(['## F1 — scn-a title', '## F2 — scn-b title'])
    expect(parseFindingNumbering(first.content)).toEqual({ 'scn-a': 1, 'scn-b': 2 })

    // scn-a was fixed and left the board: scn-b keeps F2, and F1 stays reserved.
    const second = render(board([row('scn-b', verdict('bug'))]), first.content)!
    expect(second.findings).toBe(1)
    expect(headings(second.content)).toEqual(['## F2 — scn-b title'])
    expect(parseFindingNumbering(second.content)).toEqual({ 'scn-a': 1, 'scn-b': 2 })

    // A new finding takes the next free number — never the retired F1.
    const third = render(board([row('scn-b', verdict('bug')), row('scn-c', verdict('drift'))]), second.content)!
    expect(headings(third.content)).toEqual(['## F2 — scn-b title', '## F3 — scn-c title'])
    expect(parseFindingNumbering(third.content)).toEqual({ 'scn-a': 1, 'scn-b': 2, 'scn-c': 3 })
  })

  it('starts fresh, without throwing, on a report whose registry is gone or garbage', () => {
    expect(parseFindingNumbering(null)).toEqual({})
    expect(parseFindingNumbering('# Guard findings\n\nno registry here.\n')).toEqual({})
    expect(parseFindingNumbering('<!-- numbering: {not json} -->')).toEqual({})
    expect(parseFindingNumbering('<!-- numbering: ["a"] -->')).toEqual({})
    // Non-integer / non-positive entries are dropped rather than trusted.
    expect(parseFindingNumbering('<!-- numbering: {"a":1,"b":"2","c":0,"d":1.5} -->')).toEqual({ a: 1 })
  })
})

describe('what reaches the report', () => {
  it('renders `bug` and `drift` only — every other class is recorded, not reported', () => {
    const rendered = render(
      board([
        row('scn-bug', verdict('bug')),
        row('scn-drift', verdict('drift')),
        row('scn-red', verdict('expected-red')),
        row('scn-defect', verdict('authoring-defect', { fix: { layer: 'scenario', description: 'x' } })),
        row('scn-seed', verdict('seed-defect', { fix: { layer: 'seed', description: 'x' } })),
        row('scn-infra', verdict('infrastructure')),
        // Not adjudicated at all: no verdict, no finding.
        row('scn-open'),
      ]),
      null,
    )!
    expect(rendered.findings).toBe(2)
    expect(headings(rendered.content)).toEqual(['## F1 — scn-bug title', '## F2 — scn-drift title'])
    for (const id of ['scn-red', 'scn-defect', 'scn-seed', 'scn-infra', 'scn-open']) {
      expect(rendered.content).not.toContain(id)
    }
  })

  it('states the verdict, the mechanism with its file:line, the observed value and the control', () => {
    const rendered = render(
      board([
        row(
          'scn-bug',
          verdict('bug', {
            control: { conclusion: 'confirms', reasoning: 'the control reproduced it', transcriptRef: 'control-1' },
          }),
        ),
      ]),
      null,
    )!
    expect(rendered.content).toContain('- **class**: bug (high confidence)')
    expect(rendered.content).toContain('`src/cli.ts:42`')
    expect(rendered.content).toContain('expected `exit 0` — actual `exit 2 — unknown flag`')
    expect(rendered.content).toContain('- **control**: confirms (control-1) — the control reproduced it')
    expect(rendered.content).toContain('run r1')
  })
})

describe('the doc quote, resolved live from the bind', () => {
  it('quotes the bound section when its live text still matches the fingerprint', () => {
    const rendered = render(board([row('scn-bug', verdict('bug'))]), null)!
    expect(rendered.content).toContain('> `relkit --verbose` prints the resolved config and exits 0.')
    expect(rendered.content).not.toContain('**doc quote**')
  })

  it('says the section has been edited since the scenario bound it, and still quotes it', () => {
    const stale = row('scn-bug', verdict('bug'))
    writeDoc(DOC_CONTENT.replace('exits 0', 'exits 3'))
    const rendered = render(board([stale]), null)!
    expect(rendered.content).toContain('- **doc quote**: _the section text has been edited since the scenario bound it_')
    expect(rendered.content).toContain('> `relkit --verbose` prints the resolved config and exits 3.')
  })

  it('says the section is gone, with nothing to quote', () => {
    const stale = row('scn-bug', verdict('bug'))
    writeDoc('# CLI\n\nThe relkit command line.\n')
    const rendered = render(board([stale]), null)!
    expect(rendered.content).toContain('- **doc quote**: _the bound section no longer exists in the document_')
    expect(rendered.content).not.toContain('> `relkit --verbose`')
  })

  it('says the document is not on disk', () => {
    const stale = row('scn-bug', verdict('bug'))
    fs.rmSync(path.join(repo, DOC))
    const rendered = render(board([stale]), null)!
    expect(rendered.content).toContain('- **doc quote**: _the bound document is not on disk_')
  })
})

describe('writeGuardFindingsReport — when a file is written at all', () => {
  it('writes nothing when there is nothing to say and no prior report', () => {
    expect(writeGuardFindingsReport(repo, board([row('scn-open')]))).toBeNull()
    expect(writeGuardFindingsReport(repo, null)).toBeNull()
    expect(fs.existsSync(guardFindingsReportPath(repo))).toBe(false)
  })

  it('empties an existing report honestly, keeping the numbering registry', () => {
    const written = writeGuardFindingsReport(repo, board([row('scn-a', verdict('bug'))]))!
    expect(written).toEqual({ path: path.join(repo, '.truecourse', 'guard', 'findings.md'), findings: 1 })

    // Every finding resolved: the file must SAY so rather than linger stale.
    const emptied = writeGuardFindingsReport(repo, board([row('scn-a')]))!
    expect(emptied.findings).toBe(0)
    const content = fs.readFileSync(written.path, 'utf-8')
    expect(content).toContain('No open `bug` / `drift` findings on the current board.')
    // …and F1 stays spoken for, so a returning bug never becomes a different one.
    expect(parseFindingNumbering(content)).toEqual({ 'scn-a': 1 })
    expect(headings(content)).toEqual([])
  })

  it('regenerates the report WHOLE while the findings ledger only ever appends', () => {
    const ledgerPath = guardAdjudicateFindingsPath(repo)
    expect(ledgerPath).toBe(path.join(repo, '.truecourse', 'guard', 'adjudicate.findings.md'))

    const append = (runId: string, line: string) =>
      appendFindingsLedger({
        repoRoot: repo,
        ledgerPath,
        runId,
        findings: [{ workItem: 'scn-a', lines: [line, line] }],
        now: () => '2026-02-01T00:00:00.000Z',
        preamble: '# Adjudication findings\n\n',
      })
    expect(append('run-1', 'the docs name a --verbose flag the CLI has not got')).toEqual({
      path: ledgerPath,
      appended: 1,
    })
    append('run-2', 'the exit code table is one row short')
    const ledger = fs.readFileSync(ledgerPath, 'utf-8')
    expect(ledger.match(/^## run-\d \(2026-02-01T00:00:00\.000Z\)$/gm)).toHaveLength(2)
    expect(ledger.match(/^# Adjudication findings$/gm)).toHaveLength(1)

    // The report, by contrast, is replaced by each render.
    writeGuardFindingsReport(repo, board([row('scn-a', verdict('bug'))]))
    writeGuardFindingsReport(repo, board([row('scn-b', verdict('drift'))]))
    const report = fs.readFileSync(guardFindingsReportPath(repo), 'utf-8')
    expect(headings(report)).toEqual(['## F2 — scn-b title'])
    expect(report).not.toContain('scn-a title')
    // The two files are siblings, never the same file.
    expect(fs.readFileSync(ledgerPath, 'utf-8')).toBe(ledger)
  })

  it('lands both markdown files where git TRACKS them', () => {
    ensureRepoTruecourseDir(repo)
    execFileSync('git', ['init', '-q'], { cwd: repo })
    writeGuardFindingsReport(repo, board([row('scn-a', verdict('bug'))]))
    appendFindingsLedger({
      repoRoot: repo,
      ledgerPath: guardAdjudicateFindingsPath(repo),
      runId: 'run-1',
      findings: [{ workItem: 'scn-a', lines: ['a finding'] }],
    })

    // `git check-ignore --quiet` exits 0 for an ignored path and 1 (a throw here)
    // for one git would track.
    const isIgnored = (rel: string): boolean => {
      try {
        execFileSync('git', ['check-ignore', '--quiet', '--', rel], { cwd: repo, stdio: 'pipe' })
        return true
      } catch {
        return false
      }
    }
    expect(isIgnored('.truecourse/guard/findings.md')).toBe(false)
    expect(isIgnored('.truecourse/guard/adjudicate.findings.md')).toBe(false)
    // The control: the run store next to them IS ignored, so the template is live.
    expect(isIgnored('.truecourse/guard/runs/r1.json')).toBe(true)
    expect(isIgnored('.truecourse/guard/result.json')).toBe(true)
  })
})

/**
 * The `--report` path reads the CURRENT board off the store rather than being
 * handed one — the CLI's two outcomes ("Nothing to report." vs `report N
 * finding(s) → …`) are exactly this function's `null` and its result.
 */
describe('writeGuardAdjudicationReport — the --report entry point', () => {
  it('reports nothing on a board with no bug/drift verdict', async () => {
    writeGuardLatest(repo, board([row('scn-a')]))
    expect(await writeGuardAdjudicationReport(repo)).toBeNull()
    expect(fs.existsSync(guardFindingsReportPath(repo))).toBe(false)
  })

  it('renders the board’s findings to guard/findings.md', async () => {
    writeGuardLatest(repo, board([row('scn-a', verdict('bug')), row('scn-b', verdict('drift'))]))
    const written = await writeGuardAdjudicationReport(repo)
    expect(written).toEqual({ path: guardFindingsReportPath(repo), findings: 2 })
    expect(headings(fs.readFileSync(guardFindingsReportPath(repo), 'utf-8'))).toEqual([
      '## F1 — scn-a title',
      '## F2 — scn-b title',
    ])
  })
})
