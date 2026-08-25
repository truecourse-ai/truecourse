/**
 * Book jackets, looked up in Open Library's cover service.
 *
 * The base URL is `COVERS_BASE_URL`, so a deployment can point the lookup at a
 * mirror or a cache without touching the code.
 */

import { COVERS_BASE_URL } from './config.js'

const TIMEOUT_MS = 4000

/**
 * The jacket URL for `isbn`, `null` when the service has no cover for it.
 * Throws when the cover service could not be reached at all.
 */
export async function lookupCover(isbn) {
  const url = `${COVERS_BASE_URL}/b/isbn/${isbn}-L.jpg?default=false`
  const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`cover service answered ${response.status}`)
  return url
}
