/**
 * THE NON-CANONICAL RECORD — `guard/interfaces.noncanonical.json`: every step
 * that reaches its element through `css`, with the screen it is on and the
 * reason its task gave. Derived from the catalog each time, so it says what the
 * catalog holds now and nothing else.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { guardAuthoredInterfacesPath, guardInterfacesPath } from '@truecourse/guard-runner'
import { guardNonCanonicalLocatorsPath } from '@truecourse/shared/work-tree'
import type { Interface, InterfacesFile } from '../../packages/shared/src/index'
import {
  nonCanonicalLocators,
  writeNonCanonicalLocators,
} from '../../packages/core/src/services/interface-author/non-canonical'

const DERIVED: InterfacesFile = {
  version: 2,
  generatedAt: '2026-09-23T00:00:00.000Z',
  recipeFingerprint: 'sha256:recipe',
  interfaces: [],
  resources: {
    web: [
      { id: 'tags-id', kind: 'screen', title: '/tags/{id}', address: '/tags/{id}' },
      { id: 'links', kind: 'screen', title: '/links', address: '/links' },
    ],
  },
  source: { web: 'tree' },
}

const RENAME: Interface = {
  id: 'web/rename-tag',
  type: 'web',
  title: 'Rename a tag',
  entry: { method: 'GET', path: '/tags/{id}' },
  at: 'tags-id',
  steps: [
    { kind: 'activate', target: { title: 'More' }, within: { css: 'main' }, why: 'the page icon shares its title with the sidebar button' },
    { kind: 'activate', target: { role: 'menuitem', name: 'Rename' } },
    { kind: 'activate', target: { css: 'button:has(i.bi-check2)' }, why: 'icon-only confirm button' },
  ],
  fingerprint: 'sha256:rename',
}

const SORT: Interface = {
  id: 'web/sort-links',
  type: 'web',
  title: 'Sort the links',
  entry: { method: 'GET', path: '/links' },
  steps: [
    { kind: 'navigate', route: '/links' },
    { kind: 'activate', target: { title: 'Sort', pick: 2 } },
  ],
  fingerprint: 'sha256:sort',
}

describe('the record', () => {
  it('lists every css step with its screen, task, step and reason — and no canonical one', () => {
    expect(nonCanonicalLocators({ ...DERIVED, interfaces: [RENAME, SORT] })).toEqual([
      { screen: 'tags-id', task: 'web/rename-tag', step: 1, locator: { title: 'More', within: { css: 'main' } }, why: 'the page icon shares its title with the sidebar button' },
      { screen: 'tags-id', task: 'web/rename-tag', step: 3, locator: { css: 'button:has(i.bi-check2)' }, why: 'icon-only confirm button' },
    ])
  })

  it('finds the screen of a task located by its entry address alone', () => {
    const located = { ...RENAME, at: undefined, entry: { method: 'GET', path: '/links' } }
    expect(nonCanonicalLocators({ ...DERIVED, interfaces: [located] }).map((row) => row.screen)).toEqual(['links', 'links'])
  })
})

describe('writing it', () => {
  let repo: string
  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-noncanonical-'))
    fs.mkdirSync(path.dirname(guardInterfacesPath(repo)), { recursive: true })
    fs.writeFileSync(guardInterfacesPath(repo), JSON.stringify(DERIVED))
  })
  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }))

  const author = (interfaces: Interface[]) =>
    fs.writeFileSync(guardAuthoredInterfacesPath(repo), JSON.stringify({ ...DERIVED, resources: undefined, source: undefined, interfaces }))

  it('writes the record from the merged catalog beside the findings', () => {
    author([RENAME, SORT])
    expect(writeNonCanonicalLocators(repo)).toEqual({ path: guardNonCanonicalLocatorsPath(repo), count: 2 })
    const written = JSON.parse(fs.readFileSync(guardNonCanonicalLocatorsPath(repo), 'utf-8'))
    expect(written.locators.map((row: { task: string; step: number }) => `${row.task}#${row.step}`)).toEqual(['web/rename-tag#1', 'web/rename-tag#3'])
  })

  it('removes a stale record once the catalog has no css step left', () => {
    author([RENAME])
    writeNonCanonicalLocators(repo)
    author([SORT])
    expect(writeNonCanonicalLocators(repo).count).toBe(0)
    expect(fs.existsSync(guardNonCanonicalLocatorsPath(repo))).toBe(false)
  })
})
