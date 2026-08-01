import { describe, it, expect, afterEach } from 'vitest'
import { buildAuthorDocContext } from '../../packages/guard-generator/src/prompts.js'
import { generateGuards, type GuardDoc, type GenerateRunner } from '@truecourse/guard-generator'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractBy,
  PASSING_STEPS,
  stubAuxRunners,
  authored,
} from './helpers.js'

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

describe('authoring context — the assumed environment reaches the author (item 10 rule a)', () => {
  const repos: string[] = []
  afterEach(() => {
    while (repos.length) rmrf(repos.pop()!)
  })

  it('threads config stated in prose above an example into the authoring context', async () => {
    const r = makeTempRepo()
    repos.push(r)
    writeRecipe(r)
    const docRel = 'docs/layout.md'
    writeCorpus(r, [{ ref: docRel }])
    // The section establishes a required setting in prose, then relies on it — the
    // assumed environment a scenario must reproduce in setup. The engine must hand the
    // author the WHOLE document (that config prose included) so the model can seed it.
    writeDoc(
      r,
      docRel,
      [
        '## indentation',
        'This project runs with `indent_size = 3` configured in the surrounding prose.',
        '',
        '`relkit --version` prints the version and exits 0.',
      ].join('\n'),
    )

    let seenDocContext = ''
    const capturing: GenerateRunner = async (ctx) => {
      seenDocContext = ctx.docContext
      return authored(ctx.claims.map((c) => ({ ref: c.ref, scenarios: [raw('v', PASSING_STEPS)] })))
    }

    await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractBy({}),
      generateRunner: capturing,
    })

    // The assumed-environment prose reached authoring verbatim — the model can seed it.
    expect(seenDocContext).toContain('indent_size = 3')
    expect(seenDocContext).toContain('configured in the surrounding prose')
  })
})
