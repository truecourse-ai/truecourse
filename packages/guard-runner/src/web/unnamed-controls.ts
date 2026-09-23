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
 * The accessible name is approximated here (aria-label, aria-labelledby, a
 * control's labels, its rendered text and image alt text, its title), which is
 * enough to tell "no name" and "only a glyph" apart from a real name.
 */

import type { Page } from 'playwright-core'

/** One interactive element whose accessible name is empty or glyph-only. */
export interface UnnamedControl {
  tag: string
  /** `title`, `role`, `aria-*`, `data-*` and `href`, as the element carries them. */
  attributes: Record<string, string>
  /** The icon the control draws, as `<tag>.<class>` — `i.bi-chevron-expand`. */
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
}

/** How many unnamed controls one observation reports. */
export const MAX_UNNAMED_CONTROLS = 40

/**
 * Read the page's unnamed controls. A page the scan cannot read yields none —
 * the tree is still the observation, and this is only what it cannot carry.
 */
export async function readUnnamedControls(page: Page): Promise<UnnamedControl[]> {
  try {
    const found: unknown = await page.evaluate(SCAN)
    return Array.isArray(found) ? (found as UnnamedControl[]) : []
  } catch {
    return []
  }
}

/**
 * The scan, as the page runs it. A string rather than a function because it is
 * DOM code and this package carries no DOM types; it is serialized to the browser
 * as-is either way.
 */
const SCAN = `(() => {
  const LIMIT = ${MAX_UNNAMED_CONTROLS}
  const PUA = /^[\\uE000-\\uF8FF\\u{F0000}-\\u{FFFFD}\\u{100000}-\\u{10FFFD}]$/u
  const ICON_CLASS = /^(bi|fa|fas|far|fab|fal|fad|lucide|icon|icons|ti|ri|mdi|ph|glyphicon|octicon|feather|material-icons|material-symbols)([-_]|$)/
  const INTERACTIVE = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [onclick], [tabindex]:not([tabindex="-1"]), ' +
    ['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'checkbox', 'switch', 'radio', 'option', 'combobox', 'treeitem']
      .map((role) => '[role=' + role + ']').join(', ')
  const LANDMARKS = { MAIN: 'main', NAV: 'navigation', HEADER: 'banner', FOOTER: 'contentinfo', ASIDE: 'complementary', FORM: 'form', DIALOG: 'dialog' }
  const clean = (text) => (text || '').replace(/\\s+/g, ' ').trim()
  const quote = (value) => '"' + value.replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"') + '"'
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
      if (token) return { node, text: node.tagName.toLowerCase() + '.' + token, self: node === el }
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
  const count = (selector) => { try { return document.querySelectorAll(selector).length } catch { return 0 } }
  const candidates = new Set(document.querySelectorAll(INTERACTIVE))
  for (const el of document.body.querySelectorAll('*')) if (pointerOrigin(el)) candidates.add(el)
  const out = []
  for (const el of candidates) {
    if (out.length >= LIMIT) break
    if (!visible(el)) continue
    const name = nameOf(el)
    if (!unnamed(name)) continue
    const tag = el.tagName.toLowerCase()
    const attributes = {}
    for (const attr of el.attributes) {
      if (attr.name === 'title' || attr.name === 'role' || attr.name === 'href' || attr.name.startsWith('aria-') || attr.name.startsWith('data-')) {
        attributes[attr.name] = attr.value
      }
    }
    const icon = iconOf(el)
    const region = regionOf(el)
    const data = Object.keys(attributes).find((key) => key.startsWith('data-') && attributes[key] && attributes[key].length <= 60)
    let own = tag
    if (data) own = tag + '[' + data + '=' + quote(attributes[data]) + ']'
    else if (attributes.title) own = tag + '[title=' + quote(attributes.title) + ']'
    else if (icon) own = icon.self ? icon.text : tag + ':has(' + icon.text + ')'
    else if (attributes.href) own = tag + '[href=' + quote(attributes.href) + ']'
    let selector = own
    if (count(own) > 1 && region) selector = region.selector + ' ' + own
    const matching = [...document.querySelectorAll(selector)]
    const entry = { tag, attributes, selector, matches: matching.length }
    if (icon) entry.icon = icon.text
    if (name) entry.glyph = glyphs(name).map((ch) => 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ')
    if (region) entry.region = region.words
    if (matching.length > 1) entry.position = matching.indexOf(el) + 1
    out.push(entry)
  }
  return out
})()`
