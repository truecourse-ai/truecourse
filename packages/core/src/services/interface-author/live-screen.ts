/**
 * THE LIVE SCREEN — what an authoring session sees of the RUNNING app, beside
 * the source it reads.
 *
 * Source says what a screen CAN render; the accessibility tree of the served
 * screen says what it DOES render, with the names the browser computes — the
 * exact vocabulary a step target may use. Reading both is what closes the two
 * gaps a source-only session leaves: controls whose accessible name is built
 * at runtime (an icon button named by its `aria-label`, a select trigger named
 * by its value), and controls a session never reached because the file that
 * renders them was cut off by the budget.
 *
 * The observer is INJECTED. The setup step boots the app, runs the seed and
 * signs a browser in as a seeded principal (`guard-setup/live-screens.ts`);
 * this module only knows the observer's contract, states the observation in
 * the briefing, and hands the session one tool to look again with — at a
 * filled-in address, or after opening a menu, a dialog or a tab. A run with no
 * observer is briefed exactly as it was before one existed.
 */

import { z } from 'zod'
import { defineSessionTool, type SessionTool } from '@truecourse/agent-loop'
import { ANONYMOUS_PRINCIPAL, GuardWebLocatorSchema } from '@truecourse/shared'
import { SEED_WEB_PRINCIPALS } from './principals.js'
import { boundTree, hasAddressSlot } from '@truecourse/guard-runner'
import type {
  ObserveScreenResult,
  ScreenObservation,
  ScreenObservationRequest,
  UnnamedContainer,
  UnnamedControl,
  WebScreenObserver,
} from '@truecourse/guard-runner'

export type {
  ObserveScreenResult,
  ScreenObservation,
  ScreenObservationRequest,
} from '@truecourse/guard-runner'

/** The observer an authoring run is handed — guard-runner's, by contract. */
export type LiveScreenObserver = WebScreenObserver

/**
 * What a run can observe with: the signed-in observer, and the seed's fixtures
 * so a session can fill an address slot with a row that really exists.
 */
export interface LiveScreens {
  /** The principal a session observes as unless it names another. */
  observer: LiveScreenObserver
  /**
   * Every principal a page can be observed as, by name — each web session the
   * seed minted, and `anonymous`, a browser signed in as nobody. The default
   * observer is one of them. Absent on a run that stood up one observer only.
   */
  principals?: ReadonlyMap<string, LiveScreenObserver>
  /**
   * The seed's published fixtures, name → declared fields, with every secret-
   * shaped field already removed ({@link publicFixtureFields}). What a session
   * fills `{id}` with.
   */
  fixtures?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}

/** How much of one observation the unnamed-controls list may take, beside the tree's own budget. */
const MAX_UNNAMED_BYTES = 8_000

/** How many activations one `observe_screen` call may make before it looks. */
const MAX_ACTIVATIONS = 5

/** A fixture field a session must never see: it is a secret, not an id. */
const SECRET_FIELD = /pass|secret|token|key|hash|salt|credential|cookie|session/i

/** The fixtures with their secret-shaped fields dropped. */
export function publicFixtureFields(
  fixtures: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const [name, fields] of fixtures) {
    const kept = Object.fromEntries(Object.entries(fields).filter(([field]) => !SECRET_FIELD.test(field)))
    if (Object.keys(kept).length > 0) out[name] = kept
  }
  return out
}

/**
 * The observer for a principal by name — the default when none is named. A name
 * the run cannot sign in as resolves to nothing.
 */
export function observerFor(live: LiveScreens, principal: string | undefined): LiveScreenObserver | undefined {
  if (principal === undefined || principal === live.observer.principal) return live.observer
  return live.principals?.get(principal)
}

/** The principals a session may name, the default first. */
export function principalNames(live: LiveScreens): string[] {
  const names = [...(live.principals?.keys() ?? [])]
  const own = live.observer.principal
  return own ? [own, ...names.filter((name) => name !== own)] : names
}

/** The tool: open an address in the signed-in browser and read its tree. */
export function observeScreenTool(live: LiveScreens): SessionTool {
  const names = principalNames(live)
  return defineSessionTool({
    name: 'observe_screen',
    description:
      'Open an address of the RUNNING app in the signed-in browser and return its accessibility tree — every control with the role and accessible name a step target may use — and, for every control the tree shows with no name or only an icon glyph, its tag, attributes, icon, region and a candidate css selector with its match count. Fill every {param} slot with a real value first (the briefing lists the seeded fixtures). `activate` clicks up to 5 targets in order BEFORE the tree is read, which is how a menu, a dialog or a tab panel is opened for reading; never activate anything that submits, deletes or signs out.' +
      (names.length > 1
        ? ` \`principal\` opens it as another principal instead of this session's (${names.map((name) => `\`${name}\``).join(', ')}; \`anonymous\` is signed out).`
        : ''),
    kind: 'observe-screen',
    readOnly: true,
    destructive: false,
    inputSchema: z
      .object({
        path: z.string().min(1).max(2000).describe('The address to open, path and query, every slot filled: `/repos/42/settings`.'),
        activate: z
          .array(GuardWebLocatorSchema)
          .max(MAX_ACTIVATIONS)
          .optional()
          .describe('Targets to click before reading, in order — the same locator shape a step uses.'),
        principal: z.string().min(1).optional().describe('Observe as this principal instead of the session\'s own.'),
      })
      .strict(),
    async execute(args) {
      const observer = observerFor(live, args.principal)
      if (!observer) {
        return { content: `No principal named \`${args.principal}\` — the run can observe as ${names.map((name) => `\`${name}\``).join(', ')}.`, isError: true }
      }
      const result = await observer.observe({
        path: args.path,
        ...(args.activate ? { activate: args.activate } : {}),
      })
      if (!result.ok) return { content: `The screen could not be observed: ${result.reason}`, isError: true }
      return { content: renderObservation(result.observation) }
    },
  })
}

/** One observation as the session reads it, in the briefing or a tool result. */
export function renderObservation(observation: ScreenObservation): string {
  const lines = [
    `Observed ${observation.path}` +
      (observation.address !== observation.path ? ` (the browser ended at ${observation.address})` : '') +
      (observation.title ? ` — title ${JSON.stringify(observation.title)}` : ''),
  ]
  for (const step of observation.activated) lines.push(`  activated ${step}`)
  for (const problem of observation.problems) lines.push(`  problem: ${problem}`)
  lines.push('', observation.tree.trimEnd() || '(the accessibility tree is empty)')
  if (observation.omittedLines > 0) {
    lines.push(`… ${observation.omittedLines} more line(s) of the tree not shown — observe a narrower state (a tab, a dialog) to read them.`)
  }
  const unnamedControls = (observation.unnamed ?? []).filter((control) => !control.noRole)
  if (unnamedControls.length > 0) {
    const unnamed = boundTree(unnamedControls.map((control) => `  ${describeUnnamedControl(control)}`).join('\n'), MAX_UNNAMED_BYTES)
    lines.push(
      '',
      'Controls the tree shows with NO accessible name (or only an icon glyph) — no role+name reaches them. Target one by a visible handle it has (its `title`), else by `css` with a `why`, copying a selector below and its match count:',
      unnamed.tree,
    )
    if (unnamed.omittedLines > 0) lines.push(`… ${unnamed.omittedLines} more unnamed control(s) not shown.`)
  }
  const noRole = (observation.unnamed ?? []).filter((control) => control.noRole)
  if (noRole.length > 0) {
    const listed = boundTree(noRole.map((control) => `  ${describeUnnamedControl(control)}`).join('\n'), MAX_UNNAMED_BYTES)
    lines.push(
      '',
      'Clickable elements with NO interactive role — the tree shows their text as text, not as a control (a react-select option, a click-handled card). Target one by `{"text": "<its text>"}`; fall back to `css` with a `why` only when the text is not unique or not stable:',
      listed.tree,
    )
    if (listed.omittedLines > 0) lines.push(`… ${listed.omittedLines} more clickable element(s) not shown.`)
  }
  if (observation.containers && observation.containers.length > 0) {
    lines.push(
      '',
      'Overlays holding controls with NO dialog role (a modal drawn from plain elements) — no role+name scopes a step to one. Scope a step inside it with `within: {"css": "<selector>"}` and a `why`, copying the selector:',
      ...observation.containers.map((container) => `  ${describeContainer(container)}`),
    )
  }
  return lines.join('\n')
}

/** `button · data-action="sort" · icon i.bi-sort · in main · css `main button:has(i.bi-sort)` (2 matches, this is #1)` */
function describeUnnamedControl(control: UnnamedControl): string {
  const matches = control.matches === 1
    ? '1 match'
    : `${control.matches} matches${control.position ? `, this is #${control.position}` : ''}`
  return [
    control.tag,
    ...(control.text !== undefined ? [`text ${JSON.stringify(control.text)}`] : []),
    ...Object.entries(control.attributes).map(([name, value]) => `${name}=${JSON.stringify(value)}`),
    ...(control.icon ? [`icon ${control.icon}`] : []),
    ...(control.glyph ? [`glyph ${control.glyph}`] : []),
    ...(control.region ? [`in ${control.region}`] : []),
    `css \`${control.selector}\` (${matches})`,
  ].join(' · ')
}

/** `div · heading "Delete link" · 3 controls · css `div:has(> div > button[data-testid="close"])` (1 match)` */
function describeContainer(container: UnnamedContainer): string {
  return [
    container.tag,
    ...Object.entries(container.attributes).map(([name, value]) => `${name}=${JSON.stringify(value)}`),
    ...(container.heading ? [`heading ${JSON.stringify(container.heading)}`] : []),
    `${container.controls} control(s)`,
    `css \`${container.selector}\` (${container.matches === 1 ? '1 match' : `${container.matches} matches`})`,
  ].join(' · ')
}

/**
 * The briefing's live block: what the observer saw at this place's address
 * (or why it saw nothing), whose principal it is signed in as, and the seeded
 * rows a session may fill a slot with.
 */
export function liveScreenLines(input: {
  live: LiveScreens
  /** The place's address, slots and all; absent for a place with none of its own. */
  address?: string
  /** The observation taken at the address before the session started, when the address had no slot. */
  observation?: ObserveScreenResult
  /**
   * Set when no principal the run can sign in as stays at this address — every
   * one of them was sent elsewhere — so what the session authors comes from
   * source, and a `css` locator is accepted unproven.
   */
  unreachable?: true
}): string[] {
  const own = input.live.observer.principal
  const others = principalNames(input.live).filter((name) => name !== own)
  const lines = [
    ``,
    `THE LIVE SCREEN. The app is running, and a browser is open on it` +
      (own === ANONYMOUS_PRINCIPAL && others.length > 0
        ? ` NOT SIGNED IN (\`anonymous\`): this screen is the one a signed-out user sees, and a signed-in session is sent away from it.`
        : own && own !== ANONYMOUS_PRINCIPAL
          ? ` signed in as the seeded principal \`${own}\`.`
          : ` with no principal signed in (the seed minted no web credential).`),
  ]
  if (others.length > 0) {
    lines.push(
      `The run can also observe as ${others.map((name) => `\`${name}\``).join(', ')} (\`observe_screen\` with \`principal\`).`,
      `A task only another principal can perform (an admin-only control, a member's`,
      `leave action, a signed-out form, an empty state a user with no data sees) carries`,
      `\`principal: "<name>"\`, and is proven as that principal.`,
      ...(others.includes(SEED_WEB_PRINCIPALS.empty)
        ? [
            `\`${SEED_WEB_PRINCIPALS.empty}\` is a user who owns nothing: observe this place's EMPTY state as it (the`,
            `"nothing here yet" branch and its create-first controls), and author those tasks as it.`,
          ]
        : []),
      ...(others.includes(SEED_WEB_PRINCIPALS.member)
        ? [
            `\`${SEED_WEB_PRINCIPALS.member}\` is a member of a record the default principal owns, without owning it:`,
            `a member's view and actions (leaving, a role it holds) are observed and authored as it.`,
          ]
        : []),
    )
  }
  if (input.unreachable) {
    lines.push(
      `NO PRINCIPAL REACHES THIS ADDRESS: every one the run can sign in as was sent`,
      `elsewhere (the observation below shows where). Author from source; a \`css\``,
      `locator written from source is accepted here UNPROVEN (with its \`why\`), and`,
      `recorded as unproven.`,
    )
  }
  if (input.observation) {
    if (input.observation.ok) {
      lines.push(
        `What it renders at this place's address, as an assistive reader sees it — the`,
        `role and accessible name of every control, which is exactly what a step target`,
        `may name. Trust these names over the source's spelling; a control here that`,
        `the source does not explain is still a control, and one in the source that is`,
        `not here is conditional or unreachable — say which in \`unresolved\`.`,
        ``,
        renderObservation(input.observation.observation),
      )
    } else {
      lines.push(`This place's address was opened and could not be observed: ${input.observation.reason}`)
    }
  } else if (input.address && hasAddressSlot(input.address)) {
    lines.push(
      `This place's address carries a slot, so nothing was observed for you: call`,
      `\`observe_screen\` with the slot filled from a seeded fixture below (or an id`,
      `you read the seed script minting), then author from what it shows.`,
    )
  }
  lines.push(
    `Use \`observe_screen\` to look again: at another state of this place (pass`,
    `\`activate\` to open a menu, a dialog or a tab first), or after a click that`,
    `should reveal a control the tree does not list. Never activate a control that`,
    `submits, deletes, or signs out.`,
  )
  const fixtures = Object.entries(input.live.fixtures ?? {})
  if (fixtures.length > 0) {
    lines.push(``, `The seeded fixtures (the rows the world already holds — fill an address slot with one):`)
    for (const [name, fields] of fixtures) {
      lines.push(`  ${name}: ${JSON.stringify(fields)}`)
    }
  }
  return lines
}
