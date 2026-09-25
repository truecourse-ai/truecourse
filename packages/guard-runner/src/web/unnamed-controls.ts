/**
 * THE UNNAMED CONTROLS of a page — what an accessibility tree cannot say.
 *
 * An icon-only button with no `aria-label` reads as `button ""` (or as a lone
 * private-use glyph) in the tree: it is there, and nothing in the tree says which
 * control it is or how to reach it. This scan reads the DOM beside the tree for
 * exactly those controls and hands back what a `css` locator can be written from:
 * the tag, the attributes that name it to the implementation (`title`, `aria-*`,
 * `data-*`, `href`), the icon it draws, the nearest named region it sits in, and a
 * candidate selector with the number of elements it matches right now — so an
 * author copies what it sees instead of guessing a selector.
 *
 * Two more kinds of element the tree cannot show are reported beside them:
 *
 *  - a CLICKABLE element with no interactive role (a click-handled `div`, a
 *    react-select option rendered as a plain `div`): the tree lists its text as
 *    text, never as a control. It is found by its origin of a pointer cursor, a
 *    focusable `tabindex`, or a react-select option id, and listed with its
 *    visible text, which a `{text}` handle reaches;
 *  - an unnamed DIALOG-LIKE CONTAINER: a fixed overlay covering most of the
 *    viewport and holding controls, with no `dialog` role anywhere in it (a modal
 *    drawn from plain `div`s). No role+name scopes a step to it, so it is listed
 *    with a candidate container selector a `within: {css}` can copy.
 *
 * The candidate prefers a test id (`data-testid`, `data-test`, `data-cy`), then
 * another `data-*` fact, then the `title`, the icon, the `href`, and the bare tag
 * last. A `data-*` attribute that carries a widget's momentary STATE
 * (`data-state="closed"`, `data-highlighted`, …) is listed but never chosen: the
 * selector would stop matching the moment the control is used. Class names and
 * attribute names are escaped, and a candidate the page cannot parse is passed
 * over for the next one, so one odd class never costs the rest of the list.
 *
 * The accessible name is approximated here (aria-label, aria-labelledby, a
 * control's labels, its rendered text and image alt text, its title), which is
 * enough to tell "no name" and "only a glyph" apart from a real name.
 */

import type { Page } from 'playwright-core'

/** One interactive element whose accessible name is empty or glyph-only. */
export interface UnnamedControl {
  tag: string
  /** `title`, `role`, `aria-*`, `data-*` and `href`, as the element carries them, each
   *  value cut at {@link MAX_ATTRIBUTE_CHARS} characters. */
  attributes: Record<string, string>
  /** The icon the control draws, as `<tag>.<class>` — `svg.icon-chevron`, `span.material-icons`. */
  icon?: string
  /** The private-use code points its name consists of, when it has any — `U+E0A1`. */
  glyph?: string
  /** The nearest named or landmark region around it — `main`, `navigation "Sidebar"`. */
  region?: string
  /** A candidate CSS selector for it, preferring stable attributes, then the icon, then its region. */
  selector: string
  /** How many elements that selector matches on the page right now. */
  matches: number
  /** Its 1-based position among those matches, when there is more than one. */
  position?: number
  /**
   * Set on a clickable element with NO interactive role: the tree shows it as
   * text, never as a control, and `text` is what a `{text}` handle reaches it by.
   */
  noRole?: true
  /** Its visible text, cut at {@link MAX_TEXT_CHARS} — present on a `noRole` element. */
  text?: string
}

/** A fixed overlay holding controls with no `dialog` role: a modal no role+name scopes. */
export interface UnnamedContainer {
  tag: string
  /** As on {@link UnnamedControl}. */
  attributes: Record<string, string>
  /** The first heading inside it, else the start of its text — what tells two apart. */
  heading?: string
  /** How many interactive elements it holds. */
  controls: number
  /** A candidate selector for the container itself, for a `within: {css}`. */
  selector: string
  /** How many elements that selector matches right now — a scope must match one. */
  matches: number
}

/** What one scan of a page finds. */
export interface UnnamedScan {
  controls: UnnamedControl[]
  containers: UnnamedContainer[]
}

/** How many unnamed controls one observation reports. */
export const MAX_UNNAMED_CONTROLS = 40

/** How many of those are clickable elements with no role — kept below the whole so they never crowd the unnamed ones out. */
export const MAX_NO_ROLE_CONTROLS = 20

/** How many unnamed dialog-like containers one observation reports. */
export const MAX_UNNAMED_CONTAINERS = 5

/** How much of one attribute value is listed; a longer one ends in `…`. */
export const MAX_ATTRIBUTE_CHARS = 120

/** How much of a no-role element's text, or a container's heading, is listed. */
export const MAX_TEXT_CHARS = 80

/**
 * Read the page's unnamed controls and containers. A page the scan cannot read
 * yields none — the tree is still the observation, and this is only what it
 * cannot carry.
 */
export async function readUnnamedElements(page: Page): Promise<UnnamedScan> {
  try {
    const found: unknown = await page.evaluate(SCAN)
    if (typeof found !== 'object' || found === null) return { controls: [], containers: [] }
    const scan = found as Partial<UnnamedScan>
    return {
      controls: Array.isArray(scan.controls) ? scan.controls : [],
      containers: Array.isArray(scan.containers) ? scan.containers : [],
    }
  } catch {
    return { controls: [], containers: [] }
  }
}

/**
 * The scan, as the page runs it. A string rather than a function because it is
 * DOM code and this package carries no DOM types; it is serialized to the browser
 * as-is either way.
 */
const SCAN = `(() => {
  const LIMIT = ${MAX_UNNAMED_CONTROLS}
  const NO_ROLE_LIMIT = ${MAX_NO_ROLE_CONTROLS}
  const CONTAINER_LIMIT = ${MAX_UNNAMED_CONTAINERS}
  const MAX_VALUE = ${MAX_ATTRIBUTE_CHARS}
  const MAX_TEXT = ${MAX_TEXT_CHARS}
  const TEST_IDS = ['data-testid', 'data-test', 'data-cy']
  const STATE_DATA = /^data-(state|highlighted|disabled|orientation|side|align|placeholder|selected|active|open|checked|focus.*|hover.*)$/
  const PUA = /^[\\uE000-\\uF8FF\\u{F0000}-\\u{FFFFD}\\u{100000}-\\u{10FFFD}]$/u
  const ICON_CLASS = /^(bi|fa|fas|far|fab|fal|fad|lucide|icon|icons|ti|ri|mdi|ph|glyphicon|octicon|feather|material-icons|material-symbols)([-_]|$)/
  const NATIVE = 'button, a[href], input:not([type=hidden]), select, textarea, summary'
  const ROLES = ['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'checkbox', 'switch', 'radio', 'option', 'combobox', 'treeitem']
  const INTERACTIVE = NATIVE + ', [onclick], [tabindex]:not([tabindex="-1"]), ' + ROLES.map((role) => '[role=' + role + ']').join(', ')
  const OPTION_IDS = '[id*="-option-"]'
  const DIALOGS = '[role=dialog], [role=alertdialog], dialog'
  const hasRole = (el) => el.matches(NATIVE) || ROLES.includes(el.getAttribute('role'))
  const LANDMARKS = { MAIN: 'main', NAV: 'navigation', HEADER: 'banner', FOOTER: 'contentinfo', ASIDE: 'complementary', FORM: 'form', DIALOG: 'dialog' }
  const clean = (text) => (text || '').replace(/\\s+/g, ' ').trim()
  const quote = (value) => '"' + value.replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"').replace(/\\n/g, '\\\\a ') + '"'
  const cut = (value, max = MAX_VALUE) => (value.length > max ? value.slice(0, max) + '…' : value)
  const visible = (el) => {
    const box = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  }
  const labelledBy = (el) => clean((el.getAttribute('aria-labelledby') || '').split(/\\s+/)
    .map((id) => (id && document.getElementById(id) ? document.getElementById(id).textContent : '')).join(' '))
  const nameOf = (el) => {
    const aria = clean(el.getAttribute('aria-label'))
    if (aria) return aria
    const by = labelledBy(el)
    if (by) return by
    if (el.labels && el.labels.length > 0) {
      const labels = clean([...el.labels].map((label) => label.textContent).join(' '))
      if (labels) return labels
    }
    const content = clean((el.innerText || el.textContent || '') + ' ' + [...el.querySelectorAll('img[alt]')].map((img) => img.alt).join(' '))
    if (content) return content
    if (el.tagName === 'INPUT') {
      const own = clean(el.getAttribute('placeholder') || el.getAttribute('value'))
      if (own) return own
    }
    return clean(el.getAttribute('title'))
  }
  const glyphs = (name) => [...name.replace(/\\s+/g, '')]
  const unnamed = (name) => name === '' || glyphs(name).every((ch) => PUA.test(ch))
  const pointerOrigin = (el) => getComputedStyle(el).cursor === 'pointer' &&
    (!el.parentElement || getComputedStyle(el.parentElement).cursor !== 'pointer')
  const classes = (el) => clean(el.getAttribute('class')).split(' ').filter(Boolean)
  const iconOf = (el) => {
    const tag = el.tagName.toLowerCase()
    const candidates = tag === 'i' || tag === 'svg' ? [el] : [...el.querySelectorAll('i, svg, span, img')]
    for (const node of candidates) {
      const own = classes(node)
      const token = own.find((c) => ICON_CLASS.test(c) && /[-_]/.test(c)) || own.find((c) => ICON_CLASS.test(c)) ||
        (node.tagName.toLowerCase() === 'i' ? own[0] : undefined)
      if (token) return { node, text: node.tagName.toLowerCase() + '.' + CSS.escape(token), self: node === el }
    }
    return undefined
  }
  const regionOf = (el) => {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const role = node.getAttribute('role') || LANDMARKS[node.tagName]
      const name = clean(node.getAttribute('aria-label')) || labelledBy(node)
      if (!role && !name) continue
      const words = (role || node.tagName.toLowerCase()) + (name ? ' ' + quote(name) : '')
      const selector = node.getAttribute('aria-label')
        ? node.tagName.toLowerCase() + '[aria-label=' + quote(node.getAttribute('aria-label')) + ']'
        : node.getAttribute('role') ? '[role=' + quote(node.getAttribute('role')) + ']' : node.tagName.toLowerCase()
      return { words, selector }
    }
    return undefined
  }
  const matchAll = (selector) => { try { return [...document.querySelectorAll(selector)] } catch { return undefined } }
  const describedAttributes = (el) => {
    const raw = {}
    for (const attr of el.attributes) {
      if (attr.name === 'title' || attr.name === 'role' || attr.name === 'href' || attr.name.startsWith('aria-') || attr.name.startsWith('data-')) {
        raw[attr.name] = attr.value
      }
    }
    const attributes = {}
    for (const key of Object.keys(raw)) attributes[key] = cut(raw[key])
    return { raw, attributes }
  }
  const candidates = new Set(document.querySelectorAll(INTERACTIVE + ', ' + OPTION_IDS))
  for (const el of document.body.querySelectorAll('*')) if (pointerOrigin(el)) candidates.add(el)
  const out = []
  let roleless = 0
  for (const el of candidates) {
    if (out.length >= LIMIT) break
    if (!visible(el)) continue
    // A clickable element with no role and real text is a control the tree
    // shows as text; one with no text falls through to the unnamed check.
    const text = hasRole(el) ? '' : clean(el.innerText || el.textContent || '')
    const noRole = text !== '' && !unnamed(text)
    if (noRole && roleless >= NO_ROLE_LIMIT) continue
    const name = noRole ? '' : nameOf(el)
    if (!noRole && !unnamed(name)) continue
    const tag = el.tagName.toLowerCase()
    const { raw, attributes } = describedAttributes(el)
    const icon = iconOf(el)
    const region = regionOf(el)
    const byAttribute = (key) => tag + '[' + CSS.escape(key) + '=' + quote(raw[key]) + ']'
    const dataKeys = Object.keys(raw).filter((key) => key.startsWith('data-') && raw[key] && raw[key].length <= 60 && !STATE_DATA.test(key))
    const own = [
      ...dataKeys.filter((key) => TEST_IDS.includes(key)),
      ...dataKeys.filter((key) => !TEST_IDS.includes(key)),
    ].map(byAttribute)
    if (raw.title && raw.title.length <= MAX_VALUE) own.push(byAttribute('title'))
    if (icon) own.push(icon.self ? icon.text : tag + ':has(' + icon.text + ')')
    if (raw.href && raw.href.length <= MAX_VALUE) own.push(byAttribute('href'))
    own.push(tag)
    let selector
    let matching
    for (const candidate of own) {
      matching = matchAll(candidate)
      if (matching && matching.includes(el)) { selector = candidate; break }
    }
    if (!selector) continue
    if (matching.length > 1 && region) {
      const scoped = matchAll(region.selector + ' ' + selector)
      if (scoped && scoped.includes(el)) { selector = region.selector + ' ' + selector; matching = scoped }
    }
    const entry = { tag, attributes, selector, matches: matching.length }
    if (icon) entry.icon = icon.text
    if (name) entry.glyph = glyphs(name).map((ch) => 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ')
    if (region) entry.region = region.words
    if (matching.length > 1) entry.position = matching.indexOf(el) + 1
    if (noRole) {
      entry.noRole = true
      entry.text = cut(text, MAX_TEXT)
      roleless++
    }
    out.push(entry)
  }

  // A selector for a container: a stable attribute of its own, else the child
  // path down to the nearest descendant that carries one, else its position
  // from the body. The first that matches exactly this element wins.
  const containerSelectors = (el) => {
    const tag = el.tagName.toLowerCase()
    const own = [...el.attributes]
      .filter((attr) => (attr.name === 'aria-modal' || (attr.name.startsWith('data-') && !STATE_DATA.test(attr.name))) && attr.value.length <= 60)
      .sort((a, b) => Number(TEST_IDS.includes(b.name)) - Number(TEST_IDS.includes(a.name)))
      .map((attr) => tag + '[' + CSS.escape(attr.name) + '=' + quote(attr.value) + ']')
    const queue = [{ node: el, path: [] }]
    for (let i = 0; i < queue.length && i < 400; i++) {
      const { node, path } = queue[i]
      if (path.length >= 6) continue
      const found = [...node.children].find((child) => [...child.attributes].some((attr) => TEST_IDS.includes(attr.name)))
      if (found) {
        const attr = [...found.attributes].find((a) => TEST_IDS.includes(a.name))
        own.push(tag + ':has(> ' + [...path, found.tagName.toLowerCase() + '[' + CSS.escape(attr.name) + '=' + quote(attr.value) + ']'].join(' > ') + ')')
        break
      }
      for (const child of node.children) queue.push({ node: child, path: [...path, child.tagName.toLowerCase()] })
    }
    const steps = []
    for (let node = el; node && node.parentElement && node !== document.body; node = node.parentElement) {
      steps.unshift(node.tagName.toLowerCase() + ':nth-child(' + ([...node.parentElement.children].indexOf(node) + 1) + ')')
    }
    own.push(['body', ...steps].join(' > '))
    return own
  }
  const containers = []
  for (const el of document.body.querySelectorAll('*')) {
    if (containers.length >= CONTAINER_LIMIT) break
    if (getComputedStyle(el).position !== 'fixed' || !visible(el)) continue
    const box = el.getBoundingClientRect()
    if (box.width < innerWidth * 0.5 || box.height < innerHeight * 0.5) continue
    if (el.matches(DIALOGS) || el.closest(DIALOGS) || el.querySelector(DIALOGS)) continue
    if (containers.some((found) => found.el.contains(el))) continue
    const controls = [...el.querySelectorAll(INTERACTIVE)].filter(visible).length
    if (controls === 0) continue
    let selector
    let matches = 0
    for (const candidate of containerSelectors(el)) {
      const matching = matchAll(candidate)
      if (!matching || !matching.includes(el)) continue
      selector = candidate
      matches = matching.length
      if (matches === 1) break
    }
    if (!selector) continue
    const headingNode = el.querySelector('h1, h2, h3, h4, h5, h6, [role=heading]')
    const heading = clean(headingNode ? headingNode.textContent : el.innerText)
    const entry = { el, tag: el.tagName.toLowerCase(), attributes: describedAttributes(el).attributes, controls, selector, matches }
    if (heading) entry.heading = cut(heading, MAX_TEXT)
    containers.push(entry)
  }
  return { controls: out, containers: containers.map(({ el, ...entry }) => entry) }
})()`
