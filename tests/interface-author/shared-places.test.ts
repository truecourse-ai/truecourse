/**
 * SHARED PLACES — the component modules several screens render and that own
 * behavior of their own become one place each, authored once. Detection is
 * pure: the screens' grounding and a source reader in, the places out.
 */

import { describe, it, expect } from 'vitest'
import type { WebPlaceContext } from '@truecourse/interface-mapper'
import {
  detectSharedComponents,
  ownsBehavior,
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
  'components/Sidebar.tsx': 'export function Sidebar() { return <nav><Link href="/links">Links</Link></nav> }',
  'components/LinkCard.tsx': 'import { openLink } from "../lib/openLink"\nexport function LinkCard({ link }) { return <div onClick={() => openLink(link)}>{link.name}</div> }',
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

  it('never takes a screen’s own route module', () => {
    const shared = detectSharedComponents({
      contexts: new Map([
        ['a', context('components/Sidebar.tsx', ['components/LinkCard.tsx'])],
        ['b', context('pages/b.tsx', ['components/Sidebar.tsx', 'components/LinkCard.tsx'])],
        ['c', context('pages/c.tsx', ['components/Sidebar.tsx', 'components/LinkCard.tsx'])],
      ]),
      readSource,
    })
    expect(shared.map((component) => component.module)).toEqual(['components/LinkCard.tsx'])
  })

  it('reads behavior as owned when a handler reaches past props and local state, or a link names its own address', () => {
    const owns = (source: string) => ownsBehavior('components/X.tsx', source)
    expect(owns('import { save } from "./api"\nexport function X() { return <button onClick={() => save()}>Save</button> }')).toBe(true)
    expect(owns('export function X() { const { mutate } = usePinLink(); return <button onClick={() => mutate()}>Pin</button> }')).toBe(true)
    expect(owns('export function X({ link }) { const router = useRouter(); const open = () => router.push("/links/" + link.id); return <div onClick={open} /> }')).toBe(true)
    expect(owns('export function X() { return <nav><Link href="/settings/account">Account</Link><a href={`/tags/${1}`}>Tag</a></nav> }')).toBe(true)
    expect(owns('export function Sidebar() { return <SidebarLink href={`/links/pinned`} title="Pinned" /> }')).toBe(true)
    expect(owns('export function Nav() { return <NavLink to="/settings">Settings</NavLink> }')).toBe(true)
    expect(owns('export function SettingsSidebar() { const links = [{ name: "Account", href: "/settings/account" }]; return <SecondarySidebar links={links} /> }')).toBe(true)
  })

  it('reads a building block as owning nothing: every handler goes to a prop or only flips local state', () => {
    const owns = (source: string) => ownsBehavior('components/X.tsx', source)
    expect(owns('export function Button({ onClick, ...rest }) { return <button onClick={onClick} {...rest} /> }')).toBe(false)
    expect(owns('export default function Modal({ toggleModal, children }) { return <div onClickOutside={toggleModal}><button onClick={() => toggleModal()}>x</button>{children}</div> }')).toBe(false)
    expect(owns('export const Field = (props) => <input onChange={(e) => props.onChange(e.target.value)} />')).toBe(false)
    expect(owns('export function Dropdown({ items }) { const [open, setOpen] = useState(false); const toggle = () => setOpen(!open); return <button onClick={toggle}>{items}</button> }')).toBe(false)
    expect(owns('export function Card({ href, children }) { return <Link href={href}>{children}</Link> }')).toBe(false)
    expect(owns('export function Title() { return <h1>Title</h1> }')).toBe(false)
    expect(owns('export default function Modal({ toggleModal }) { const [open, setOpen] = React.useState(true); return <Drawer onClose={() => setOpen(false)}><button onClick={toggleModal as MouseEventHandler}>x</button></Drawer> }')).toBe(false)
    expect(owns('export default function App() { return <Head><link rel="icon" href="/favicon.png" /></Head> }')).toBe(false)
    // A local-state flip a hook wraps is still a local-state flip.
    expect(owns('export function Menu() { const [open, setOpen] = useState(false); const show = useCallback(() => setOpen(true), []); return <button onClick={show}>Menu</button> }')).toBe(false)
    expect(owns('export function Menu() { const [open, setOpen] = useState(false); const hide = useMemo(() => () => setOpen(false), []); return <button onClick={hide}>x</button> }')).toBe(false)
    // A value named `to` that is no address.
    expect(owns('export function Range() { const range = { from: "Monday", to: "Friday" }; return <Days range={range} /> }')).toBe(false)
    // Clicking its own hidden input opens the file picker: its own UI.
    expect(owns('export function Picker() { const inputRef = useRef(null); return <><input ref={inputRef} type="file" hidden /><button onClick={() => inputRef.current.click()}>Choose</button></> }')).toBe(false)
  })

  it('follows a hook-wrapped handler into what it does', () => {
    expect(ownsBehavior('components/X.tsx', 'import { save } from "./api"\nexport function X() { const onSave = useCallback(() => save(), []); return <button onClick={onSave}>Save</button> }')).toBe(true)
  })

  it('mints a kebab-case id from the module path, stable across runs', () => {
    const id = sharedComponentId('apps/web/components/LinkViews/LinkComponents/LinkActions.tsx')
    expect(id).toMatch(/^component-link-actions-[0-9a-f]{8}$/)
    expect(sharedComponentId('apps/web/components/LinkViews/LinkComponents/LinkActions.tsx')).toBe(id)
    expect(sharedComponentId('apps/web/components/SearchModal/index.tsx')).toMatch(/^component-search-modal-/)
  })
})
