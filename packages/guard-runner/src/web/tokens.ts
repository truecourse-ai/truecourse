/**
 * Token resolution for a web step — `${unique}`, `${supplied:…}`, `${sandbox}` and
 * `${captured:…}` in every string the scenario AUTHORED, and nowhere else.
 *
 * There is one rule and it is the same rule the cli driver follows: a scenario's own
 * strings are interpolated, the recipe's are not. What is new is only WHICH strings
 * a web step has — a path, an accessible name, a typed value, a matcher — so this is
 * a traversal, not a second substitution engine. The caller passes the same `tok`
 * closure the cli steps use, which is what guarantees a token means the same thing
 * on both surfaces.
 */

import type { GuardStreamMatcher, GuardWebExpect, GuardWebLocator, GuardWebStep } from '@truecourse/shared'
import { isWebClickStep, isWebFillStep, isWebNavigateStep } from '@truecourse/shared'

type Tok = (text: string) => string

/** A locator with its accessible name resolved (the role is a closed enum). */
function resolveLocator(locator: GuardWebLocator, tok: Tok): GuardWebLocator {
  return { ...locator, name: tok(locator.name) }
}

/** A text matcher with every authored value resolved — the comparands included. */
function resolveMatcher(matcher: GuardStreamMatcher, tok: Tok): GuardStreamMatcher {
  return {
    ...matcher,
    ...(matcher.equals !== undefined ? { equals: tok(matcher.equals) } : {}),
    ...(matcher.contains !== undefined ? { contains: tok(matcher.contains) } : {}),
    ...(matcher.matches !== undefined ? { matches: tok(matcher.matches) } : {}),
    ...(matcher.compare
      ? {
          compare: {
            ...matcher.compare,
            ...(typeof matcher.compare.equals === 'string' ? { equals: tok(matcher.compare.equals) } : {}),
            ...(typeof matcher.compare.atMost === 'string' ? { atMost: tok(matcher.compare.atMost) } : {}),
            ...(typeof matcher.compare.atLeast === 'string' ? { atLeast: tok(matcher.compare.atLeast) } : {}),
          },
        }
      : {}),
  }
}

/** A web expectation with every authored string resolved. */
function resolveExpect(expect: GuardWebExpect, tok: Tok): GuardWebExpect {
  return {
    ...expect,
    ...(expect.text ? { text: resolveMatcher(expect.text, tok) } : {}),
    ...(expect.url ? { url: resolveMatcher(expect.url, tok) } : {}),
    ...(expect.within ? { within: resolveLocator(expect.within, tok) } : {}),
    // One target or several — the list form resolves element by element, so a
    // toolbar of targets carries tokens exactly as a single one does.
    ...(expect.visible
      ? {
          visible: Array.isArray(expect.visible)
            ? expect.visible.map((target) => resolveLocator(target, tok))
            : resolveLocator(expect.visible, tok),
        }
      : {}),
    // A state assertion is a locator with booleans on it: only the name interpolates.
    ...(expect.state ? { state: { ...expect.state, name: tok(expect.state.name) } } : {}),
    ...(expect.attribute
      ? {
          attribute: {
            ...expect.attribute,
            ...(expect.attribute.of ? { of: resolveLocator(expect.attribute.of, tok) } : {}),
            name: tok(expect.attribute.name),
            ...(expect.attribute.value ? { value: resolveMatcher(expect.attribute.value, tok) } : {}),
          },
        }
      : {}),
    ...(expect.class
      ? {
          class: {
            ...expect.class,
            ...(expect.class.of ? { of: resolveLocator(expect.class.of, tok) } : {}),
            ...(expect.class.has !== undefined ? { has: tok(expect.class.has) } : {}),
            ...(expect.class.absent !== undefined ? { absent: tok(expect.class.absent) } : {}),
          },
        }
      : {}),
  }
}

/**
 * The step the browser actually takes: every authored string with its tokens
 * substituted, so the action, the assertion, the transcript and the failure message
 * all quote the RESOLVED text a reader can act on.
 */
export function resolveWebStep(step: GuardWebStep, tok: Tok): GuardWebStep {
  const expect = step.expect ? { expect: resolveExpect(step.expect, tok) } : {}
  if (isWebNavigateStep(step)) return { ...step, navigate: tok(step.navigate), ...expect }
  if (isWebClickStep(step)) return { ...step, click: resolveLocator(step.click, tok), ...expect }
  if (isWebFillStep(step)) {
    return { ...step, fill: resolveLocator(step.fill, tok), value: tok(step.value), ...expect }
  }
  return { ...step, ...(step.expect ? { expect: resolveExpect(step.expect, tok) } : {}) }
}
