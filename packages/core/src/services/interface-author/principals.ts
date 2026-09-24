/**
 * WHO SEES A SCREEN — the principal each screen is observed as.
 *
 * One signed-in browser is not every user. An admin page sends a member back to
 * the dashboard, a login page sends a signed-in user away, and a screen observed
 * as the wrong principal is authored from source with nothing live to prove it.
 * So each screen is observed as the principal its source asks for — an admin
 * guard asks for an admin, a signed-out route for nobody — and when the first
 * look is sent away from the screen's address, the other principals are tried in
 * turn and the first that STAYS is the one the session observes as.
 */

import { ANONYMOUS_PRINCIPAL } from '@truecourse/shared'
import type { LiveScreenObserver, LiveScreens, ObserveScreenResult } from './live-screen.js'
import { principalNames } from './live-screen.js'

/**
 * The web sessions the seed mints for its coverage world, by the credential
 * name each is published under: the OWNER who holds the seeded data, the
 * instance ADMIN, a MEMBER who shares a record the owner owns without owning
 * it, and an EMPTY user who owns nothing (the one empty states are observed
 * as). The owner is the default principal; the others exist when the app has
 * the concept.
 */
export const SEED_WEB_PRINCIPALS = {
  owner: 'webSession',
  admin: 'adminWebSession',
  member: 'memberWebSession',
  empty: 'emptyWebSession',
} as const

/** Which principal a screen's source or address asks for, when it asks. */
export type PrincipalHint = 'admin' | 'anonymous'

/** An address segment that names a page for a signed-out user. */
const SIGNED_OUT_SEGMENT = /^(?:login|log-in|signin|sign-in|signup|sign-up|register|forgot|forgot-password|reset-password|password-reset|confirmation|verify|verify-email|auth)$/i

/** Source that bounces a signed-in user away: a redirect taken when a session exists. */
const SIGNED_OUT_SOURCE = /if\s*\(\s*(?:session|user|isLoggedIn|isAuthenticated)\s*\)\s*\{?\s*return\s*\{\s*redirect|status\s*===\s*['"]authenticated['"]\s*\)?\s*(?:\{\s*)?(?:router\.)?(?:push|replace)\(/

/** Source that admits only an admin: an admin flag, an instance-admin id, an admin role check. */
const ADMIN_SOURCE = /\bisAdmin\b|\bIS_ADMIN\b|\bconfig\.ADMIN\b|\bADMIN_USER\b|role\s*[!=]==?\s*['"](?:admin|superadmin|owner)['"]|['"](?:admin|superadmin)['"]\s*[!=]==?\s*[\w.]*role/i

/** An admin area's address. */
const ADMIN_SEGMENT = /^admin$/i

/**
 * The principal a screen asks for, from its address and its route module's
 * source: `anonymous` for a signed-out page, `admin` for an admin-only one,
 * nothing for everything else (the default principal).
 */
export function principalHint(address: string | undefined, source: string | undefined): PrincipalHint | undefined {
  const segments = (address ?? '').split('/').filter(Boolean)
  if (segments.some((segment) => SIGNED_OUT_SEGMENT.test(segment)) || (source && SIGNED_OUT_SOURCE.test(source))) {
    return 'anonymous'
  }
  if (segments.some((segment) => ADMIN_SEGMENT.test(segment)) || (source && ADMIN_SOURCE.test(source))) return 'admin'
  return undefined
}

/**
 * The principals to try for a screen, in order: the ones its hint names (the
 * seed's admin session first, then any other session named for an admin; or
 * `anonymous`), then the default, then the seed's admin, member and empty
 * sessions, then any other — the signed-out browser last unless it was asked for.
 */
export function principalOrder(live: LiveScreens, hint: PrincipalHint | undefined): string[] {
  const names = principalNames(live)
  const admins = [
    ...names.filter((name) => name === SEED_WEB_PRINCIPALS.admin),
    ...names.filter((name) => name !== SEED_WEB_PRINCIPALS.admin && /admin/i.test(name)),
  ]
  const hinted =
    hint === 'anonymous' ? names.filter((name) => name === ANONYMOUS_PRINCIPAL) : hint === 'admin' ? admins : []
  const seeded: string[] = [SEED_WEB_PRINCIPALS.admin, SEED_WEB_PRINCIPALS.member, SEED_WEB_PRINCIPALS.empty]
  const rank = (name: string): number =>
    name === live.observer.principal ? -1 : seeded.includes(name) ? seeded.indexOf(name) : seeded.length
  const rest = names
    .filter((name) => !hinted.includes(name) && name !== ANONYMOUS_PRINCIPAL)
    .sort((a, b) => rank(a) - rank(b))
  const anonymous = names.includes(ANONYMOUS_PRINCIPAL) && !hinted.includes(ANONYMOUS_PRINCIPAL) ? [ANONYMOUS_PRINCIPAL] : []
  return [...hinted, ...rest, ...anonymous]
}

/** What observing a screen found: who it was observed as, what they saw, and whether they stayed. */
export interface PrincipalChoice {
  /** The principal the session observes as; the default's name when none stayed. */
  principal: string | undefined
  observation: ObserveScreenResult
  /** False when every principal was sent away from the address. */
  reached: boolean
}

/**
 * Observe a literal address as the principals in {@link principalOrder}, and
 * keep the first that stays on it. When none stays, the first look is kept
 * (it shows where the browser was sent) and the screen is unreached.
 */
export async function observeAsPrincipal(
  live: LiveScreens,
  address: string,
  hint: PrincipalHint | undefined,
): Promise<PrincipalChoice> {
  const order = principalOrder(live, hint)
  const observers: [string | undefined, LiveScreenObserver][] = order.length > 0
    ? order.flatMap((name) => {
        const observer = name === live.observer.principal ? live.observer : live.principals?.get(name)
        return observer ? [[name, observer] as [string, LiveScreenObserver]] : []
      })
    : [[live.observer.principal, live.observer]]
  let first: PrincipalChoice | undefined
  for (const [name, observer] of observers) {
    const observation = await observer.observe({ path: address })
    const stayed = observation.ok && staysAt(observation.observation.address, address)
    if (stayed) return { principal: name, observation, reached: true }
    first ??= { principal: name, observation, reached: false }
  }
  return first ?? { principal: live.observer.principal, observation: { ok: false, reason: 'no principal to observe as' }, reached: false }
}

/** Did the browser end on the address it was sent to (query and trailing slash aside)? */
function staysAt(ended: string, address: string): boolean {
  const path = (value: string) => value.split(/[?#]/)[0].replace(/\/+$/, '') || '/'
  return path(ended) === path(address)
}
