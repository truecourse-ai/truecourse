/**
 * SCREEN NEEDS — what a screen's source branches on (the size of a list), and
 * what an earlier authoring could not reach, read before the seed so the seeded
 * world can hold it.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { guardAuthoredInterfacesPath } from '@truecourse/guard-runner'
import { deriveScreenNeeds, stateGaps } from '../../packages/core/src/services/interface-author/screen-needs'
import { gatherScreenNeeds, screenNeedLines } from '../../packages/core/src/services/guard-setup/seed-session'

const SOURCES: Record<string, string> = {
  'pages/links/pinned.tsx': [
    'export default function Pinned() {',
    '  const { data: pinnedLinks } = useLinks({ pinnedOnly: true })',
    '  if (!pinnedLinks.length) return <NoLinksFound />',
    '  return <Links links={pinnedLinks} />',
    '}',
  ].join('\n'),
  'pages/tags.tsx': [
    'export default function Tags() {',
    '  return <button disabled={selectedTags.length < 2} onClick={merge}>Merge</button>',
    '  {tags?.length > 0 && <TagList tags={tags} />}',
    '  {tags.length === 0 && <EmptyTags />}',
    '}',
  ].join('\n'),
  'pages/settings.tsx': 'export default function Settings() { return <Form fields={fields.slice(0, fields.length)} /> }',
}

describe('deriving what the screens need', () => {
  it('reads a list-size branch of a screen’s source as a need, with where it was read', () => {
    const needs = deriveScreenNeeds({
      files: new Map([
        ['links-pinned', ['pages/links/pinned.tsx']],
        ['tags', ['pages/tags.tsx']],
        ['settings', ['pages/settings.tsx']],
      ]),
      readSource: (file) => SOURCES[file],
    })
    expect(needs).toEqual([
      { screen: 'links-pinned', need: 'an empty `pinnedLinks` (its empty state) (pages/links/pinned.tsx:3)' },
      { screen: 'tags', need: 'at least 2 `selectedTags` (pages/tags.tsx:2)' },
      { screen: 'tags', need: 'at least one `tags` (pages/tags.tsx:3)' },
      { screen: 'tags', need: 'an empty `tags` (its empty state) (pages/tags.tsx:4)' },
    ])
  })

  it('puts what an earlier authoring could not reach first, from the ledger', () => {
    const needs = deriveScreenNeeds({
      files: new Map(),
      ledger: {
        'links-pinned': {
          status: 'authored',
          inputFingerprint: 'x',
          stateGaps: ['Pinned link cards render only when pinned links exist; the seeded world has no pinned link'],
        },
      },
      readSource: () => undefined,
    })
    expect(needs).toEqual([
      {
        screen: 'links-pinned',
        need: 'the last authoring could not reach: Pinned link cards render only when pinned links exist; the seeded world has no pinned link',
      },
    ])
  })

  it('keeps only the unresolved lines about a missing world state on a ledger row', () => {
    expect(
      stateGaps([
        'Remove photo renders only when the user has an image; the seeded user has none',
        'Preserved format rows were not rendered because preservation is pending',
        'Opening the original URL is external and not authored as a task',
      ]),
    ).toEqual([
      'Remove photo renders only when the user has an image; the seeded user has none',
      'Preserved format rows were not rendered because preservation is pending',
    ])
  })
})

describe('the seed briefing', () => {
  it('lists the needs with what to do about each kind, and nothing when there are none', () => {
    const text = screenNeedLines([{ screen: 'tags', need: 'at least 2 `tags` (pages/tags.tsx:2)' }]).join('\n')
    expect(text).toContain('## Screen states the interface catalog needs')
    expect(text).toContain('- tags: at least 2 `tags` (pages/tags.tsx:2)')
    expect(text).toContain('`unmetNeeds`')
    expect(text).toContain('the member principal owns no data')
    expect(screenNeedLines([])).toEqual([])
  })
})

describe('gathering the needs for a seed', () => {
  it('reads a setup that authored before by its ledger: the files each screen was grounded on, and its gaps', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-screen-needs-'))
    try {
      fs.mkdirSync(path.join(repo, 'pages'), { recursive: true })
      fs.writeFileSync(path.join(repo, 'pages', 'tags.tsx'), SOURCES['pages/tags.tsx'])
      fs.mkdirSync(path.dirname(guardAuthoredInterfacesPath(repo)), { recursive: true })
      fs.writeFileSync(
        guardAuthoredInterfacesPath(repo),
        JSON.stringify({
          version: 2,
          generatedAt: '',
          recipeFingerprint: '',
          interfaces: [],
          authoring: {
            tags: { status: 'authored', inputFingerprint: 'x', sources: { 'pages/tags.tsx': 'abc' }, stateGaps: ['merge needs two tags; the seed has one'] },
          },
        }),
      )
      const needs = await gatherScreenNeeds(repo)
      expect(needs.map((need) => need.need)).toEqual([
        'the last authoring could not reach: merge needs two tags; the seed has one',
        'at least 2 `selectedTags` (pages/tags.tsx:2)',
        'at least one `tags` (pages/tags.tsx:3)',
        'an empty `tags` (its empty state) (pages/tags.tsx:4)',
      ])
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })
})
