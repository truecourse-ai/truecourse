/**
 * SHARED PLACES — the component modules several screens render and that own a
 * handler become one place each, authored once. Detection is pure: the screens'
 * grounding and a source reader in, the places out.
 */

import { describe, it, expect } from 'vitest'
import type { WebPlaceContext } from '@truecourse/interface-mapper'
import {
  detectSharedComponents,
  ownsHandler,
  sharedComponentId,
} from '../../packages/core/src/services/interface-author/shared-places'

const context = (module: string, renders: string[]): WebPlaceContext => ({
  module,
  renders,
  closure: renders.length + 1,
  renderClosure: renders,
  apiEffects: [],
  unjoined: [],
  rpcCalls: [],
})

const SOURCES: Record<string, string> = {
  'components/Sidebar.tsx': 'export function Sidebar() { return <button onClick={() => setOpen(!open)}>Collapse</button> }',
  'components/LinkCard.tsx': 'export function LinkCard({ link }) { return <div onClick={openLink}>{link.name}</div> }',
  'components/Button.tsx': 'export function Button({ onClick, ...rest }) { return <button onClick={onClick} {...rest} /> }',
  'components/Header.tsx': 'export function Header() { return <h1>Links</h1> }',
  'components/LinksView.tsx': 'export function LinksView() { return <ul onScroll={() => load()} /> }',
}

const readSource = (module: string) => SOURCES[module]

describe('detecting the shared components', () => {
  it('makes one place of a module two screens render that owns a handler, and none of a single-use one', () => {
    const shared = detectSharedComponents({
      contexts: new Map([
        ['links', context('pages/links.tsx', ['components/LinksView.tsx', 'components/Sidebar.tsx', 'components/LinkCard.tsx'])],
        ['tags', context('pages/tags.tsx', ['components/Sidebar.tsx', 'components/LinkCard.tsx', 'components/Header.tsx'])],
        ['dashboard', context('pages/dashboard.tsx', ['components/Sidebar.tsx', 'components/Button.tsx'])],
        ['settings', context('pages/settings.tsx', ['components/Button.tsx', 'components/Header.tsx'])],
      ]),
      readSource,
    })
    expect(shared).toEqual([
      { id: sharedComponentId('components/Sidebar.tsx'), module: 'components/Sidebar.tsx', title: 'Sidebar', screens: ['links', 'tags', 'dashboard'] },
      { id: sharedComponentId('components/LinkCard.tsx'), module: 'components/LinkCard.tsx', title: 'LinkCard', screens: ['links', 'tags'] },
    ])
  })

  it('never takes a screen’s own route module, and caps the most widely rendered', () => {
    const shared = detectSharedComponents({
      contexts: new Map([
        ['a', context('components/Sidebar.tsx', ['components/LinkCard.tsx'])],
        ['b', context('pages/b.tsx', ['components/Sidebar.tsx', 'components/LinkCard.tsx'])],
        ['c', context('pages/c.tsx', ['components/Sidebar.tsx', 'components/LinkCard.tsx'])],
      ]),
      readSource,
      max: 1,
    })
    expect(shared.map((component) => component.module)).toEqual(['components/LinkCard.tsx'])
  })

  it('reads a handler as owned unless it only forwards the one it was given', () => {
    expect(ownsHandler('<button onClick={() => save()}>')).toBe(true)
    expect(ownsHandler('<button onClick={handleSave}>')).toBe(true)
    expect(ownsHandler('<form onSubmit={(e) => { e.preventDefault(); submit({ a: 1 }) }}>')).toBe(true)
    expect(ownsHandler('<button onClick={onClick} onChange={props.onChange}>')).toBe(false)
    expect(ownsHandler('<h1>Title</h1>')).toBe(false)
    expect(ownsHandler(undefined)).toBe(false)
  })

  it('mints a kebab-case id from the module path, stable across runs', () => {
    const id = sharedComponentId('apps/web/components/LinkViews/LinkComponents/LinkActions.tsx')
    expect(id).toMatch(/^component-link-actions-[0-9a-f]{8}$/)
    expect(sharedComponentId('apps/web/components/LinkViews/LinkComponents/LinkActions.tsx')).toBe(id)
    expect(sharedComponentId('apps/web/components/SearchModal/index.tsx')).toMatch(/^component-search-modal-/)
  })
})
