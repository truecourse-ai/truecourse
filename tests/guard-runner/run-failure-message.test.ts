import { describe, it, expect } from 'vitest'
import { runFailureMessage, type RunGuardResult } from '@truecourse/guard-runner'
import type { GuardLatest } from '@truecourse/shared'

// The ONE human wording per non-ok status, shared by the CLI command, the
// dashboard run route, and birth validation. Literals are asserted independently
// here so a wording change is a deliberate edit to this file, not drift.
describe('runFailureMessage', () => {
  it('returns null for ok', () => {
    const ok: RunGuardResult = {
      status: 'ok',
      latest: {} as GuardLatest,
      latestPath: '',
      loadErrors: [],
      manifest: null,
    }
    expect(runFailureMessage(ok)).toBeNull()
  })

  it('no-recipe', () => {
    expect(runFailureMessage({ status: 'no-recipe' })).toBe(
      'No .truecourse/scenarios/recipe.json found. Add a recipe describing how to build and invoke the entrypoint.',
    )
  })

  it('invalid-recipe carries the parse message', () => {
    expect(runFailureMessage({ status: 'invalid-recipe', message: 'entry must be an array' })).toBe(
      'recipe.json is invalid: entry must be an array',
    )
  })

  it('missing-credential-env surfaces the resolver message verbatim', () => {
    expect(
      runFailureMessage({
        status: 'missing-credential-env',
        message: 'credential "api-key" reads its value from env var API_KEY, which is not set',
      }),
    ).toBe('credential "api-key" reads its value from env var API_KEY, which is not set')
  })

  it('seed-failed surfaces the seed message verbatim', () => {
    expect(
      runFailureMessage({
        status: 'seed-failed',
        message: 'seed command `node seed.mjs` exited 1\nboom: db unreachable',
      }),
    ).toBe('seed command `node seed.mjs` exited 1\nboom: db unreachable')
  })

  it('no-scenarios (whole corpus)', () => {
    expect(runFailureMessage({ status: 'no-scenarios', loadErrors: [] })).toBe(
      'No scenarios found under .truecourse/scenarios/.',
    )
  })

  it('no-scenarios with a requested id names it', () => {
    expect(
      runFailureMessage({ status: 'no-scenarios', loadErrors: [], requestedId: 'auth-01' }),
    ).toBe('No scenario with id "auth-01".')
  })

  it('build-failed quotes the command', () => {
    expect(
      runFailureMessage({
        status: 'build-failed',
        build: { ok: false, command: 'pnpm build', exitCode: 1, timedOut: false, output: '' },
        loadErrors: [],
      }),
    ).toBe('Build failed (`pnpm build`). No scenarios ran.')
  })

  it('build-failed marks a timeout', () => {
    expect(
      runFailureMessage({
        status: 'build-failed',
        build: { ok: false, command: 'pnpm build', exitCode: null, timedOut: true, output: '' },
        loadErrors: [],
      }),
    ).toBe('Build failed (`pnpm build`) — timed out. No scenarios ran.')
  })

  it('entry-preflight-failed renders the full self-contained preflight error', () => {
    const msg = runFailureMessage({
      status: 'entry-preflight-failed',
      preflight: {
        ok: false,
        entry: 'node dist/cli.js',
        stderr: "Cannot find module './missing.js'",
        probes: [],
      },
      buildCommand: 'pnpm build',
      loadErrors: [],
    })
    expect(msg).toContain('The recipe entry `node dist/cli.js` failed to start')
    expect(msg).toContain('Rebuild it with `pnpm build`')
    expect(msg).toContain("Cannot find module './missing.js'")
  })

  it('run-timed-out reports elapsed seconds and settled counts', () => {
    expect(
      runFailureMessage({ status: 'run-timed-out', elapsedMs: 61_400, settled: 3, total: 9 }),
    ).toBe(
      'Guard run timed out after 61s — 3/9 scenarios settled; in-flight scenarios were aborted.',
    )
  })

  it('aborted names the phase', () => {
    expect(runFailureMessage({ status: 'aborted', phase: 'build' })).toBe(
      'Guard run was aborted during the build phase.',
    )
    expect(runFailureMessage({ status: 'aborted', phase: 'run' })).toBe(
      'Guard run was aborted during the run phase.',
    )
  })
})
