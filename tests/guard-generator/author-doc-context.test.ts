import { describe, it, expect } from 'vitest'
import { buildAuthorDocContext } from '../../packages/guard-generator/src/prompts.js'
import type { GuardDoc } from '@truecourse/guard-generator'

/** A GuardDoc carrying only what buildAuthorDocContext reads (its full content). */
function doc(content: string): GuardDoc {
  return { doc: 'docs/big.md', content, sections: [], suppressedQuotes: [] }
}

describe('buildAuthorDocContext (item 1 — always the full document)', () => {
  it('sends the whole document even far past the retired 48k budget — no outline fallback', () => {
    const content = `## big\n${'x'.repeat(60_000)}`
    expect(content.length).toBeGreaterThan(48_000)
    // The full content, verbatim — never a titles-only outline + cited sections.
    expect(buildAuthorDocContext(doc(content))).toBe(content)
  })

  it('sends the whole document for a small doc too', () => {
    const content = '## version\n`relkit --version` prints the version and exits 0.'
    expect(buildAuthorDocContext(doc(content))).toBe(content)
  })
})
