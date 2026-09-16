import { describe, it, expect } from 'vitest'
import { buildOutputTail } from '@truecourse/guard-runner'

const ESC = String.fromCharCode(27)

// The failure message carries the compiler's own last words: colour codes
// stripped, blank lines dropped, only the last N lines kept.
describe('buildOutputTail', () => {
  it('keeps the last non-empty lines and strips ANSI colour', () => {
    const output = [
      `${ESC}[32m✓ compiled${ESC}[0m`,
      '',
      '',
      'Type error: x is not assignable\r',
      '  at page.tsx:4',
      '',
      'error Command failed with exit code 1.',
      '',
    ].join('\n')
    expect(buildOutputTail(output, 3)).toBe(
      'Type error: x is not assignable\n  at page.tsx:4\nerror Command failed with exit code 1.',
    )
  })

  it('returns everything when the output is shorter than the cap', () => {
    expect(buildOutputTail('one\ntwo\n')).toBe('one\ntwo')
  })

  it('is empty for output with no words', () => {
    expect(buildOutputTail('\n  \n')).toBe('')
  })
})
