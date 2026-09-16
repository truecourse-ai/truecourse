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

  it('treats a lone carriage return as a line end, so a redrawn progress bar keeps the error after it', () => {
    const output = 'Progress: 1/3\rProgress: 2/3\rProgress: 3/3\nerror TS2304: boom\n'
    expect(buildOutputTail(output, 2)).toBe('Progress: 3/3\nerror TS2304: boom')
  })

  it('drops control bytes a job row cannot store', () => {
    expect(buildOutputTail('a\u0000b\u0007c\td\n')).toBe('abc\td')
  })

  it('caps the tail by size, keeping the end', () => {
    const line = 'x'.repeat(200)
    const tail = buildOutputTail(Array.from({ length: 40 }, () => line).join('\n') + '\nlast')
    expect(tail.length).toBe(3000)
    expect(tail.endsWith('\nlast')).toBe(true)
  })
})
