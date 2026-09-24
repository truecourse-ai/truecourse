/**
 * WHO A SCREEN IS SEEN AS — the principals a live screen can be observed and
 * acted on as.
 *
 * Which principal a screen or a task belongs to is the authoring SESSION's call:
 * it is briefed with every principal the seed minted and what makes each one
 * distinct (the seed's own description of it), reads the screen's source, and
 * names the principal it observes as (`observe_screen`) and the one each task
 * runs as (`principal` on the task). The engine chooses nothing: every screen's
 * first look is taken as the DEFAULT principal, the owner of the seeded data.
 *
 * The one fact the engine settles itself is whether an address is reachable at
 * all: a proof sent away from its address asks every principal, each opening
 * the page the way the observer does (a load, retries, the app's own links),
 * and an address none of them reaches is one no principal can prove anything on.
 */

import { ANONYMOUS_PRINCIPAL } from '@truecourse/shared'
import { principalNames, type LiveScreens } from './live-screen.js'

/** The credential the seed publishes the owner of the seeded data's web session under: the default principal. */
export const DEFAULT_WEB_PRINCIPAL = 'webSession'

/**
 * The principals that reach `path`, the default first: each opens it with no
 * step to take, and one whose browser ended elsewhere after every attempt does
 * not reach it.
 */
export async function principalsReaching(live: LiveScreens, path: string): Promise<string[]> {
  const names = principalNames(live)
  const observers = names.length > 0
    ? names.flatMap((name) => {
        const observer = name === live.observer.principal ? live.observer : live.principals?.get(name)
        return observer ? [{ name, observer }] : []
      })
    : [{ name: live.observer.principal ?? ANONYMOUS_PRINCIPAL, observer: live.observer }]
  const reaching: string[] = []
  for (const { name, observer } of observers) {
    if ((await observer.probe({ path, steps: [] })).ok) reaching.push(name)
  }
  return reaching
}
