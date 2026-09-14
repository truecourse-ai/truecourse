import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WebPlaceContext } from '@truecourse/interface-mapper'
import { MAX_PLACE_PACK_BYTES, placeSourcePack } from '../../packages/core/src/services/interface-author/place-pack'
import { clusterPack, MAX_PACK_BYTES } from '../../packages/core/src/services/interface-author/pack'

let repo: string
beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-place-source-')) })
afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }) })
const write = (file: string, source: string) => fs.writeFileSync(path.join(repo, file), source)
const context = (module: string, ...renders: string[]): WebPlaceContext => ({ module, renders, closure: renders.length + 1, apiEffects: [], rpcCalls: [], unjoined: [] })

describe('per-screen source', () => {
  it('includes a singleton route and its views, with lossless late controls', () => {
    write('route.tsx', "import { Form } from './form'; export const Page = Form")
    write('form.tsx', ' '.repeat(800) + '<button>Cancel expense</button>')
    const pack = placeSourcePack(repo, context('route.tsx', './form.tsx', 'form.tsx'))!
    expect(pack.entries.map(e => e.status)).toEqual(['complete', 'complete'])
    expect(pack.text).toContain('Cancel expense')
    expect(pack.bytes).toBe(Buffer.byteLength(pack.text))
    expect(pack.bytes).toBeLessThanOrEqual(MAX_PLACE_PACK_BYTES)
    expect(placeSourcePack(repo, undefined)).toBeUndefined()
  })

  it('leaves room for views after a large route and provides exact continuations', () => {
    write('route.tsx', '🙂'.repeat(20_000) + '<button>Save editor</button>')
    write('form.tsx', '<button>Cancel</button>')
    const pack = placeSourcePack(repo, context('route.tsx', 'form.tsx'))!
    expect(pack.entries[0].status).toBe('partial')
    expect(pack.entries[0].next!.startColumn).toBeGreaterThan(1)
    expect(pack.entries[1].status).toBe('complete')
    expect(pack.text).toContain('Cancel')
    expect(pack.text).toContain('Continue with read_file(')
    expect(pack.bytes).toBeLessThanOrEqual(MAX_PLACE_PACK_BYTES)
  })

  it('supplies all short lines when the whole route fits its source budget', () => {
    write('route.tsx', '\n'.repeat(500) + '<button>Late control</button>')
    const pack = placeSourcePack(repo, context('route.tsx'))!
    expect(pack.entries[0].status).toBe('complete')
    expect(pack.text).toContain('501\t<button>Late control</button>')
  })

  it('deduplicates only files supplied whole in the shared pack', () => {
    write('route.tsx', '<Form/>')
    write('shared.tsx', '<button>Shared</button>')
    write('large.tsx', '界'.repeat(30_000))
    const shared = clusterPack(repo, { id: 'cluster/a', places: ['a', 'b'], shared: ['shared.tsx', 'large.tsx'] })!
    const pack = placeSourcePack(repo, context('route.tsx', './shared.tsx', 'large.tsx'), shared.modules)!
    expect(pack.entries.map(e => e.status)).toEqual(['complete', 'shared-complete', 'partial'])
    expect(pack.text).not.toContain('<button>Shared</button>')
    expect(shared.omitted).toEqual(['large.tsx'])
  })

  it('reports missing, outside, oversized, configuration and escaping symlink candidates', () => {
    write('route.tsx', '<div/>')
    write('huge.tsx', 'x'.repeat(2_000_001))
    write('.env', 'SECRET=hidden')
    fs.symlinkSync(os.tmpdir(), path.join(repo, 'external'))
    const pack = placeSourcePack(repo, context('route.tsx', 'missing.tsx', '../outside.tsx', 'huge.tsx', '.env', 'external/out.tsx'))!
    expect(pack.entries.slice(1).every(e => e.status === 'unavailable')).toBe(true)
    expect(pack.text).not.toContain('SECRET=hidden')
  })

  it('bounds source and manifests even for thousands of candidates', () => {
    write('route.tsx', '<div/>')
    const mapping = context('route.tsx', ...Array.from({ length: 2_000 }, (_, n) => `missing-${n}-${'界'.repeat(80)}.tsx`))
    const pack = placeSourcePack(repo, mapping)!
    expect(pack.manifestComplete).toBe(false)
    expect(pack.text).toContain('Manifest incomplete')
    expect(pack.bytes).toBeLessThanOrEqual(MAX_PLACE_PACK_BYTES)
    expect(placeSourcePack(repo, mapping)).toEqual(pack)
  })

  it('accounts for Unicode bytes and includes every character in complete shared modules', () => {
    write('small.tsx', '🙂'.repeat(1_000) + '<button>Delete</button>')
    write('big.tsx', '🙂'.repeat(20_000))
    const pack = clusterPack(repo, { id: 'cluster/a', places: ['a', 'b'], shared: ['big.tsx', 'small.tsx'] })!
    expect(pack.modules).toEqual(['small.tsx'])
    expect(pack.omitted).toEqual(['big.tsx'])
    expect(pack.text).toContain('🙂'.repeat(1_000) + '<button>Delete</button>')
    expect(pack.bytes).toBe(Buffer.byteLength(pack.text))
    expect(pack.bytes).toBeLessThanOrEqual(MAX_PACK_BYTES)
  })

  it('packs a complete late editor and shared dialog while preserving missing-source evidence', () => {
    const fixtures = path.resolve('tests/fixtures/interface-context')
    const editor = fs.readFileSync(path.join(fixtures, 'DocumentEditor.tsx'), 'utf8')
    const dialog = fs.readFileSync(path.join(fixtures, 'EditorDialog.tsx'), 'utf8')
    write('route.tsx', `export const translations = ${JSON.stringify('word '.repeat(8_000))}\n\n${editor}`)
    write('EditorDialog.tsx', dialog)
    const shared = clusterPack(repo, { id: 'cluster/editor', places: ['a', 'b'], shared: ['EditorDialog.tsx'] })!
    const pack = placeSourcePack(repo, context('route.tsx', 'EditorDialog.tsx'), shared.modules)!
    expect(pack.entries[0].status).toBe('partial')
    expect(pack.entries[0].units?.some(unit => unit.name === 'DocumentEditor')).toBe(true)
    expect(pack.entries[0].omitted?.[0].start).toEqual({ start: 1, startColumn: 1 })
    for (const behavior of ['Title is required', 'Save failed', 'Deletion failed', 'setDraft(record.title)', 'confirmDelete', 'setShowDelete(false)']) expect(pack.text).toContain(behavior)
    for (const behavior of ['Escape', '!busy', 'Confirm deletion', 'Keep document']) expect(shared.text).toContain(behavior)
    expect(pack.entries[1].status).toBe('shared-complete')
    expect(pack.bytes).toBeLessThanOrEqual(MAX_PLACE_PACK_BYTES)
    expect(shared.bytes).toBeLessThanOrEqual(MAX_PACK_BYTES)
    const changed = dialog.replace('Keep document', 'Keep envelope')
    expect(changed.length).toBe(dialog.length)
    write('EditorDialog.tsx', changed)
    const refreshed = clusterPack(repo, { id: 'cluster/editor', places: ['a', 'b'], shared: ['EditorDialog.tsx'] })!
    expect(refreshed.text).not.toBe(shared.text)
    expect(refreshed.text).toContain('Keep envelope')
    expect(refreshed.text.match(/Source SHA-256: (.*)/)?.[1]).not.toBe(shared.text.match(/Source SHA-256: (.*)/)?.[1])
  })
})
