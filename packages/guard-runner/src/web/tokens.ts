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

import type {
  GuardStreamMatcher,
  GuardWebExpect,
  GuardWebFile,
  GuardWebLocator,
  GuardWebStep,
} from '@truecourse/shared'
import {
  isWebClickStep,
  isWebFillStep,
  isWebNavigateStep,
  isWebUploadStep,
  webLocatorValueKey,
} from '@truecourse/shared'

type Tok = (text: string) => string

/**
 * A locator with its authored value resolved — whichever handle the member
 * addresses its element by (the accessible name, a placeholder, a label, the
 * element's text, a title, an alt text). The role itself is a closed enum and
 * carries nothing to interpolate.
 *
 * Takes any locator-SHAPED object, so a state expectation — a locator with the
 * ARIA assertions on it — resolves through this one function too.
 */
function resolveLocator<T extends object>(locator: T, tok: Tok): T {
  const key = webLocatorValueKey(locator)
  const value = (locator as Record<string, unknown>)[key]
  return typeof value === 'string' ? { ...locator, [key]: tok(value) } : locator
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
    // A state assertion is a locator with booleans on it: only its handle interpolates.
    ...(expect.state ? { state: resolveLocator(expect.state, tok) } : {}),
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
 * An uploaded file with every authored string resolved: the bytes (`text`, or the
 * `base64` a `{{fixture:…}}` put there), the sandbox-relative source, and the NAME
 * the app is shown — which is the one that matters most, because an app that titles
 * a resource after its filename needs `${unique}` to reach it or two runs of one
 * scenario collide in the app's own data. `type` is a MIME type, never a template.
 */
function resolveFile(file: GuardWebFile, tok: Tok): GuardWebFile {
  return {
    ...file,
    ...(file.base64 !== undefined ? { base64: tok(file.base64) } : {}),
    ...(file.text !== undefined ? { text: tok(file.text) } : {}),
    ...(file.path !== undefined ? { path: tok(file.path) } : {}),
    ...(file.as !== undefined ? { as: tok(file.as) } : {}),
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
  if (isWebUploadStep(step)) {
    return { ...step, upload: resolveLocator(step.upload, tok), file: resolveFile(step.file, tok), ...expect }
  }
  return { ...step, ...(step.expect ? { expect: resolveExpect(step.expect, tok) } : {}) }
}
