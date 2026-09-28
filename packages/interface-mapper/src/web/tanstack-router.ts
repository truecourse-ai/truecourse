/**
 * TanStack file-route IDs become screen addresses. Groups and pathless parents
 * disappear, trailing underscores opt out of nesting, and $name is a slot.
 * A pathless layout alone declares no address; its index child does. Splats
 * require an arbitrary path and are omitted, as in the Remix reader.
 */
import type { WebPlaceSeed, WebTree } from '../web-tree.js'

export function readTanStackRoutes(tree: WebTree): WebPlaceSeed[] {
  const seeds: WebPlaceSeed[] = []
  for (const analysis of tree.analyses) {
    for (const route of analysis.tanStackRoutes ?? []) {
      if (!route.hasComponent) continue
      const address = routeAddress(route.routeId)
      if (address === null) continue
      seeds.push({ kind: 'screen', address, idiom: 'tanstack-router', filePath: analysis.filePath })
    }
  }
  return seeds
}

function pathless(segment: string): boolean {
  return segment.startsWith('_') || /^\(.*\)$/.test(segment)
}

function routeAddress(id: string): string | null {
  const segments = id.split('/').filter(Boolean)
  const last = segments.at(-1)
  if (last && pathless(last) && !id.endsWith('/')) return null
  const address: string[] = []
  for (const segment of segments) {
    if (pathless(segment)) continue
    const part = segment.replace(/_$/, '')
    if (part === '$') return null
    if (part.startsWith('$')) {
      if (!/^\$[A-Za-z_][\w]*$/.test(part)) return null
      address.push(`{${part.slice(1)}}`)
    } else {
      // Optional or affixed parameter patterns need their own address expansion.
      if (/[${}]/.test(part)) return null
      address.push(part)
    }
  }
  return `/${address.join('/')}`
}
