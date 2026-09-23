/**
 * SHARED PLACES — the UI several screens render, authored ONCE as a place of its
 * own instead of by every screen (or by none).
 *
 * A screen session reads its route module and the modules it renders. The
 * layout's sidebar, a list's card actions, the search modal are rendered by a
 * dozen screens, and each screen's session reasonably decides they are "the
 * shared layout's", so nobody authors them. Ownership is the gap, and the
 * grounding already holds the answer: a component module rendered by two or more
 * screens, which OWNS an interactive handler (not one that only forwards the
 * `onClick` it was given), is a shared place — kind `component`, an id derived
 * from its module path, authored by one session at a screen that renders it.
 *
 * Pure: the screens' grounding and a source reader in, the places out, the same
 * input always giving the same places in the same order.
 */

import { createHash } from 'node:crypto'
import path from 'node:path'
import type { WebPlaceContext } from '@truecourse/interface-mapper'

/** One component module rendered by several screens, and the place it becomes. */
export interface SharedComponent {
  /** `component-<name>-<hash>`: stable for as long as the module path is. */
  id: string
  /** The module, repo-relative. */
  module: string
  /** The component's name as its file names it — `LinkActions`. */
  title: string
  /** The screens that render it, in the order the grounding lists them. */
  screens: string[]
}

/** The most shared places one run creates: the most widely rendered win. */
export const MAX_SHARED_COMPONENTS = 40

/** How many screens must render a module before it is shared. */
const MIN_SCREENS = 2

/** A JSX event handler attribute and the expression it is given. */
const HANDLER = /\bon[A-Z][A-Za-z]*=\{/g

/** An expression that only forwards a handler the component was handed: `onClick`, `props.onChange`, `rest.onSelect`. */
const FORWARDED = /^\s*(?:[A-Za-z_$][\w$]*\.)?on[A-Z]\w*\s*$/

export interface DetectSharedComponentsInput {
  /** Screen id → its grounding. Only screens: a component's own grounding is not an input. */
  contexts: ReadonlyMap<string, WebPlaceContext>
  /** A module's source, repo-relative path in; undefined when it cannot be read. */
  readSource: (module: string) => string | undefined
  max?: number
}

/**
 * The shared components of a set of screens: every rendered module two or more
 * screens list, that is no screen's own route module, and that owns a handler.
 * Most widely rendered first, ties by path.
 */
export function detectSharedComponents(input: DetectSharedComponentsInput): SharedComponent[] {
  const routeModules = new Set([...input.contexts.values()].map((context) => context.module))
  const renderedBy = new Map<string, string[]>()
  for (const [screen, context] of input.contexts) {
    for (const module of new Set(context.renders)) {
      if (routeModules.has(module)) continue
      renderedBy.set(module, [...(renderedBy.get(module) ?? []), screen])
    }
  }
  return [...renderedBy.entries()]
    .filter(([, screens]) => screens.length >= MIN_SCREENS)
    .sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b))
    .filter(([module]) => ownsHandler(input.readSource(module)))
    .slice(0, input.max ?? MAX_SHARED_COMPONENTS)
    .map(([module, screens]) => ({ id: sharedComponentId(module), module, title: componentName(module), screens }))
}

/**
 * Does this source attach a handler of its own? A handler attribute whose
 * expression is more than a forwarded prop (`onClick={onClick}`) is one: an
 * inline function, a local handler, a call.
 */
export function ownsHandler(source: string | undefined): boolean {
  if (!source) return false
  for (const match of source.matchAll(HANDLER)) {
    const expression = balancedExpression(source, (match.index ?? 0) + match[0].length)
    if (expression !== undefined && !FORWARDED.test(expression)) return true
  }
  return false
}

/** The text between the `{` just before `start` and its matching `}`. */
function balancedExpression(source: string, start: number): string | undefined {
  let depth = 1
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i)
  }
  return undefined
}

/** `component-link-actions-1a2b3c4d` for `apps/web/components/LinkActions.tsx`. */
export function sharedComponentId(module: string): string {
  const slug = componentName(module)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  const hash = createHash('sha256').update(module).digest('hex').slice(0, 8)
  return `component-${slug ? `${slug}-` : ''}${hash}`
}

/** The component's name: its file's base name, or its folder's when the file is an `index`. */
function componentName(module: string): string {
  const base = path.basename(module, path.extname(module))
  return base === 'index' ? path.basename(path.dirname(module)) : base
}
