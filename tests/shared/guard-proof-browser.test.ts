import { describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import path from 'node:path'

describe('guard proof browser boundary', () => {
  it('bundles the shared proof schemas and helpers without Node built-ins', async () => {
    const result = await build({
      entryPoints: [path.resolve('packages/shared/src/guard/proof.ts')],
      bundle: true,
      platform: 'browser',
      format: 'esm',
      write: false,
      logLevel: 'silent',
    })
    expect(result.outputFiles[0].text).toContain('GuardCaseEvidenceSchema')
    expect(result.outputFiles[0].text).toContain('scenarioMilestoneProof')
  })
})
