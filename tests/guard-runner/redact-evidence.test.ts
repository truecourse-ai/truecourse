import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCredentialRedactor } from '../../packages/guard-runner/src/api/redact.js'
import { redactEvidence, redactScenarioResult } from '../../packages/guard-runner/src/redact-evidence.js'
import { writeEvidence, type WriteEvidenceParams } from '../../packages/guard-runner/src/evidence.js'

describe('structured credential redaction', () => {
  it('escapes unusual labels when writing JSON and preserves matching structural names and outcomes', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-redaction-'))
    const redact = buildCredentialRedactor(
      new Map(),
      new Map([
        ['provider"\\key', 'pass'],
        ['other', 'actual'],
      ]),
    )
    const mask = '«external:provider"\\key»'
    try {
      const params: WriteEvidenceParams = {
        repoRoot,
        runId: 'run',
        scenarioId: 'pass',
        title: 'pass',
        binds: [],
        outcome: 'pass',
        sandboxCwd: repoRoot,
        envPins: { actual: 'pass' },
        steps: [
          {
            index: 1,
            kind: 'web',
            argv: [],
            repeat: 1,
            iterationsRun: 1,
            exitCode: 0,
            timedOut: false,
            rawStdout: 'pass',
            rawStderr: '',
            normStdout: 'pass',
            normStderr: '',
            durationMs: 1,
            web: {
              command: 'read status',
              expectation: 'pass',
              url: '/',
              visibleText: 'pass',
              checks: [{ subject: 'text', expected: 'pass', actual: 'pass', ok: true }],
            },
          },
        ],
      }
      const relative = writeEvidence(redactEvidence(params, redact))
      const invocation = JSON.parse(fs.readFileSync(path.join(repoRoot, relative, 'invocation.json'), 'utf8'))
      expect(invocation).toMatchObject({ scenarioId: 'pass', outcome: 'pass', envPins: { actual: mask } })
      expect(invocation.steps[0].web).toMatchObject({
        visibleText: mask,
        checks: [{ subject: 'text', expected: mask, actual: mask, ok: true }],
      })
      expect(
        redactScenarioResult(
          { id: 'pass', title: 'pass', binds: { doc: 'README.md', section: 'pass' }, outcome: 'pass', durationMs: 1 },
          redact,
        ),
      ).toMatchObject({ id: 'pass', outcome: 'pass' })
      expect(
        redactScenarioResult(
          {
            id: 'actual',
            title: 'failure',
            binds: { doc: 'README.md', section: 'pass' },
            outcome: 'fail',
            durationMs: 1,
            failure: { step: 1, expected: 'pass', actual: 'pass', stdout: 'pass' },
          },
          redact,
        ),
      ).toMatchObject({ id: 'actual', outcome: 'fail', failure: { expected: mask, actual: mask, stdout: mask } })
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true })
    }
  })
})
