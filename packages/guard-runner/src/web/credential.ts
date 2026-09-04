/**
 * The browser's PRINCIPAL CHANNEL: how a `credential` step puts one of the
 * world's credentials into the page, so a scenario starts signed in without
 * visiting the login screen.
 *
 * The world's credentials are the recipe's declared ones plus what the seed
 * minted — each a request HEADER and a secret value, the same set an api step
 * references as `{{cred:<name>}}`. The browser has two places such a header can
 * live, and the header's name decides which:
 *   - `Cookie` → the value IS a cookie header (`a=1; b=2`), so it becomes the
 *     surface's cookies — what the app's own login would have set — and the
 *     page sends them back exactly as a signed-in browser does;
 *   - anything else (`Authorization`, an api-key header) → an extra header the
 *     page sends on every request it makes.
 * The value never reaches the evidence: the step's record names the credential,
 * and the page text is the app's, not the secret's.
 */

import type { Page } from 'playwright-core'

/** One credential of the prepared world: the header it rides in, and its secret. */
export interface WorldCredential {
  header: string
  value: string
}

export type InstallWebCredentialResult = { ok: true; via: 'cookies' | 'header' } | { ok: false; reason: string }

/**
 * Parse a `Cookie` request-header value into its name/value pairs. Values are
 * kept byte-for-byte (a signed cookie is opaque; decoding it would corrupt it).
 * Segments without an `=` are skipped — they are not cookies.
 */
export function parseCookieHeader(value: string): { name: string; value: string }[] {
  return value
    .split(';')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .flatMap((segment) => {
      const eq = segment.indexOf('=')
      if (eq <= 0) return []
      return [{ name: segment.slice(0, eq).trim(), value: segment.slice(eq + 1).trim() }]
    })
}

/**
 * Install `credential` into the page for the surface at `baseUrl`. Cookies are
 * scoped to the surface's origin (Playwright's `url` form), so nothing leaks to
 * another host the page might reach. Extra headers accumulate across steps: a
 * second credential with a different header does not evict the first.
 */
export async function installWebCredential(
  page: Page,
  baseUrl: string,
  name: string,
  credential: WorldCredential,
  headersSoFar: Record<string, string>,
): Promise<InstallWebCredentialResult> {
  if (credential.header.toLowerCase() === 'cookie') {
    const cookies = parseCookieHeader(credential.value)
    if (cookies.length === 0) {
      return { ok: false, reason: `credential "${name}" is a Cookie header holding no name=value pair — nothing to install` }
    }
    try {
      await page.context().addCookies(cookies.map((c) => ({ ...c, url: baseUrl })))
    } catch (e) {
      return { ok: false, reason: `the browser refused the cookies of credential "${name}": ${firstLine(e)}` }
    }
    return { ok: true, via: 'cookies' }
  }
  headersSoFar[credential.header] = credential.value
  try {
    await page.setExtraHTTPHeaders({ ...headersSoFar })
  } catch (e) {
    return { ok: false, reason: `the browser refused the ${credential.header} header of credential "${name}": ${firstLine(e)}` }
  }
  return { ok: true, via: 'header' }
}

function firstLine(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  return message.split('\n')[0].trim()
}
