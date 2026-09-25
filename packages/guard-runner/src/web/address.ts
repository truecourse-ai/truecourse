import { canonicalizePath, templateMatches } from '../route-manifest.js'

/**
 * Whether a web address still carries a routing slot (`/repos/{id}`). A slotted
 * address names a family of pages, not one page, so nothing can open it until
 * a real value fills every slot. The screen observer refuses one, the
 * authoring run observes only the addresses without one before its sessions
 * start, and the briefing tells a session to fill the slots itself.
 */
export function hasAddressSlot(address: string): boolean {
  return /\{[^}]*\}/.test(address)
}

/**
 * Whether `address` is one page of the family `template` declares: the same
 * path segments, each literal one equal and each `{slot}` filled with a
 * non-empty value. The query string is not compared on either side.
 */
export function addressFillsTemplate(address: string, template: string): boolean {
  const filled = canonicalizePath(address)
  const declared = canonicalizePath(template)
  if (filled === null || declared === null) return false
  return templateMatches(declared, filled.split('/').filter(Boolean))
}
