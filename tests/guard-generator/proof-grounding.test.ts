import { describe, it, expect } from 'vitest'
import { invocationProofGap, navigationGroundingProblem } from '../../packages/guard-generator/src/proof-grounding.js'
import { GuardWebLocatorSchema, describeWebLocator, verificationCapabilityGap } from '@truecourse/shared'
describe('proof grounding', () => {
  it('selects unnamed roles without inventing their accessible names', () => {
    expect(describeWebLocator(GuardWebLocatorSchema.parse({ role: 'status' }))).toBe('status')
    expect(GuardWebLocatorSchema.safeParse({ role: 'status', name: '' }).success).toBe(false)
    expect(describeWebLocator({ role: 'status', name: 'Saved' })).toContain('Saved')
  })
  it('rejects invented query triggers and accepts documented or mapped query state', () => {
    expect(navigationGroundingProblem('/?page=999', ['/'], 'Next and Previous navigate.')).toContain('undocumented')
    expect(navigationGroundingProblem('/?page=999', ['/?page=1'], '')).toBeUndefined()
    expect(navigationGroundingProblem('/?page=999', ['/'], 'Open /?page=999 to test clamping.')).toBeUndefined()
  })
  it('does not credit production readiness as development command/address proof', () => {
    expect(invocationProofGap({ command: 'pnpm dev', address: 'http://127.0.0.1:3000' }, ['next', 'start'])).toContain(
      'required invocation',
    )
    expect(invocationProofGap({ command: 'pnpm dev', address: 'http://127.0.0.1:3000' }, ['pnpm', 'dev'])).toContain(
      'isolated port',
    )
    expect(invocationProofGap({ command: 'pnpm dev' }, ['pnpm', 'dev'])).toBeUndefined()
  })
  it('keeps browser timezone control unsupported while ordinary display remains supported', () => {
    const verification = {
      method: 'behavior' as const,
      observable: 'Date invariant',
      cases: [
        {
          id: 'zones',
          claim: 'Invariant',
          method: 'behavior' as const,
          requires: ['browser' as const, 'browser-timezone-control' as const],
          conditions: [],
        },
      ],
    }
    expect(verificationCapabilityGap(verification, 'web')).toContain('browser-timezone-control')
    expect(
      verificationCapabilityGap(
        { ...verification, cases: [{ ...verification.cases[0], requires: ['browser'] }] },
        'web',
      ),
    ).toBeUndefined()
  })
})

it('keeps ordinary CLI commands outside the server-startup proof gate', async () => {
  const { partitionFlowPrerequisites } = await import('../../packages/guard-generator/src/prerequisites.js')
  const { EXTRACT_SESSION_SYSTEM_PROMPT } = await import('../../packages/core/src/services/guard-generate/extract.js')
  expect(EXTRACT_SESSION_SYSTEM_PROMPT).toContain('Ordinary CLI behavior (for example relkit --version)')
  const flow = {
    id: 'version',
    title: 'Version',
    goal: 'Print version',
    bindings: [],
    composedOf: [],
    fingerprint: 'sha256:version',
    synthesisInputsHash: 'inputs',
    milestones: [
      {
        order: 1,
        doc: 'cli.md',
        anchor: 'version',
        claimTitle: 'relkit --version prints version',
        proofDrivers: ['cli' as const],
        verification: {
          method: 'behavior' as const,
          scope: 'configuration' as const,
          observable: 'Version printed',
          cases: [
            {
              id: 'version',
              claim: 'Version printed',
              method: 'behavior' as const,
              requires: ['process' as const],
              conditions: [],
              invocation: { command: 'relkit --version' },
            },
          ],
        },
      },
    ],
  }
  // Even older unscoped metadata must not compare a CLI command to api.serve.
  const partition = partitionFlowPrerequisites(flow, 'cli', [], { build: 'true', entry: ['node', 'bin.mjs'] })
  expect(partition.gaps).toEqual([])
  expect(partition.flow).toEqual(flow)
})
