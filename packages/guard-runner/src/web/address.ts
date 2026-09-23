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
