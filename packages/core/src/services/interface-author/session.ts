/**
 * THE AUTHORING SESSION — `guard-interfaces.web-tasks`, one session per PLACE.
 *
 * The agent loop is the pipeline's only LLM call
 * shape, and this is the first stage built on it: the session reads the app's
 * own source for one screen, and hands back the tasks a user can perform there.
 *
 * WHY THE PLACE IS THE WORK ITEM. A web task is "one task from one state", and
 * the state a task starts from is a place plus a world. Scoping a
 * session to one screen gives it a bounded reading job (that screen's route
 * module and the components it renders), a natural done-condition (the controls
 * of that screen are accounted for), and a work item that re-runs
 * independently: authoring one place again re-authors nothing else. It also
 * matches how the derivation now works — the places are derived, so the
 * work list is a fact about the repository rather than a plan somebody typed.
 *
 * The done-condition is the OUTCOME, and the outcome is a fragment that
 * {@link validateFragment} accepts. A session that cannot state a task from what
 * the source says returns zero tasks and says why in `unresolved` — an empty
 * honest fragment is a result, not a failure.
 */

import type { SessionBudget, SessionDef } from '@truecourse/agent-loop'
import type { WebPlaceContext } from '@truecourse/interface-mapper'
import { CheckedDraftReferenceSchema, resolveCheckedDraft } from './checked-draft.js'
import { screenIdentityGuidance } from './identity.js'
import type { InterfaceResource, InterfaceState, InterfacesFile } from '@truecourse/shared'
import { AuthoredFragmentSchema, type AuthoredFragment } from './draft.js'
import { liveScreenLines, type LiveScreens, type ObserveScreenResult } from './live-screen.js'
import { buildAuthorTools, type AuthorToolsInput } from './tools.js'

export const INTERFACE_AUTHOR_SESSION_KIND = 'guard-interfaces.web-tasks'

/**
 * The three numbers. Reading one screen's JSX is a handful of searches
 * and reads, then a check-and-revise cycle; 30 turns covers that with room for
 * a wrong first guess about which file renders the screen. ONE automatic resume
 * grant, because the failure mode this session actually has is a long file
 * paged through in 400-line windows — not an infinite loop. The ceiling
 * pre-empts the provider wall (compaction never runs) at a level a screen's
 * component tree comfortably fits under.
 */
export const INTERFACE_AUTHOR_BUDGET: SessionBudget = {
  turns: 30,
  maxResumes: 1,
  tokenCeiling: 150_000,
}

/** What a session is built over — exactly what its tools read. */
export type AuthorSessionInput = AuthorToolsInput

export function interfaceAuthorSessionDef(input: AuthorSessionInput): SessionDef<AuthoredFragment> {
  return {
    kind: INTERFACE_AUTHOR_SESSION_KIND,
    display: { title: 'Web tasks' },
    systemPrompt: SYSTEM_PROMPT,
    tools: buildAuthorTools(input),
    outcomeSchema: AuthoredFragmentSchema,
    outcomeInputSchema: CheckedDraftReferenceSchema,
    resolveOutcome: resolveCheckedDraft,
    outcomeSchemaRepairs: 2,
    budget: INTERFACE_AUTHOR_BUDGET,
    // The structural half of "run check_draft". The prompt already
    // demands it in the strongest available terms and did not carry it: across
    // 110 measured sessions the median first `check_draft` was turn 9, and 8
    // sessions never called it at all — each of those risking a whole fragment
    // dropped at the outcome for a rule one turn would have caught. So the
    // shell refuses the FIRST outcome of a session that never ran it, feeds
    // this message back, and lets the session continue (not malformed, at most
    // once, on the ordinary budget).
    outcomePrecondition: {
      tool: 'check_draft',
      message:
        'Outcome refused: you never ran `check_draft` in this session. Call `check_draft` on your draft now — it runs the exact validation the write path will run, so a problem it finds costs one turn to fix here instead of the whole fragment at the outcome. Fix anything it reports, then call `outcome` with the draftId of the accepted check.',
    },
  }
}

/** The work item, as the session index and the transcript record it. */
export function placeWorkItem(placeId: string): string {
  return `web:${placeId}`
}

/** A shared place another session authors, as a briefing names it. */
export interface SharedPlaceBrief {
  id: string
  title: string
  /** The tasks the catalog already has at it — what a session references instead of authoring. */
  tasks: readonly string[]
}

export interface PlaceBriefingInput {
  place: InterfaceResource
  /**
   * Set when the place is a SHARED COMPONENT: the module it is rendered from,
   * the screens that render it, and the address of the one it is authored at.
   */
  component?: { module: string; screens: readonly string[]; address?: string }
  /** The shared places this place renders — authored in sessions of their own. */
  sharedPlaces?: readonly SharedPlaceBrief[]
  /** Ids of the tasks already authored at this place — the ones the session accounts for. */
  existing: readonly string[]
  ownTaskContext?: string
  sourcePack?: string
  /** What the AST pass knows about this place, when it knows anything. */
  context?: WebPlaceContext
  /** The worlds the catalog already names — the ids this session reuses. */
  states: readonly InterfaceState[]
  /** Every screen the catalog knows, in catalog order — what `to` may name. */
  screens: readonly { id: string; address?: string }[]
  /** The dialogs and panels that sit on THIS place — what `of` already names. */
  nested: readonly InterfaceResource[]
  /**
   * The running app, when the run booted one: the principals and fixtures, and
   * what the default principal saw at this place's address before the session
   * started (taken only for an address with no slot).
   */
  live?: { screens: LiveScreens; observation?: ObserveScreenResult }
}

/**
 * The opening message: which place, at which address, what the AST pass already
 * knows about it, what is already authored there, and which worlds the catalog
 * already names.
 *
 * The context block is the difference between a session that reads and
 * a session that searches for something to read. Without it the first pilot spent
 * a third of its turns rediscovering the route module, walking to the components
 * that carry the accessible names, and guessing api ids against a surface where
 * none of the guessed names existed. All three are facts the derivation computed
 * and dropped, so they are stated here — as facts, with their limits named, so a
 * session neither re-derives them nor trusts them further than they go.
 *
 * The registry is here for the same reason and one more: a session that cannot
 * SEE the worlds already named mints a synonym for each one, and named states
 * exist precisely so tasks chain by id equality ACROSS places. It rides in the
 * briefing rather than behind a tool because a tool is opt-in — the reuse it
 * enables only happens if the session looks before it drafts, and the pilot's
 * sessions did not look. It costs a table a session reads once instead of a turn
 * it spends asking.
 *
 * The PLACES are here for a third reason on top of those two: they were
 * a tool, and a tool result is re-sent on every turn that follows it while a
 * briefing sits in the prefix a provider caches. Only the two facts a draft
 * actually resolves against are stated — the screens with their addresses, which
 * is what `to` may name, and the places on THIS one, which is what `of` names.
 */
export function placeBriefing({
  place,
  existing,
  ownTaskContext,
  sourcePack,
  context,
  states,
  screens,
  nested,
  live,
  component,
  sharedPlaces = [],
}: PlaceBriefingInput): string {
  const address = place.address ?? component?.address
  const lines = [
    `Author the web tasks and readable facts of ONE place.`,
    ``,
    `  place    ${place.id} (${place.kind})`,
    `  address  ${
      place.address ??
      (component?.address
        ? `— (a shared component has no address of its own; it is authored at ${component.address})`
        : '— (this place has no address of its own; it sits on one)')
    }`,
    `  title    ${place.title}`,
    ``,
    screenIdentityGuidance({ screenId: place.id, address }),
    ``,
    ...(component ? componentLines(place.id, component) : []),
    ...(context ? contextLines(context) : []),
    `Every task you author is performed HERE: \`at: "${place.id}"\`, or at a dialog`,
    `or panel that sits on this place — declare any such place in \`resources\` with`,
    `\`of: "${place.id}"\`. Their \`entry.path\` is ${address ? `\`${address}\`` : "this place's address"} either way.`,
    `A task of another screen belongs to another session and will be refused.`,
    ...sharedPlaceLines(sharedPlaces),
  ]
  if (existing.length > 0) {
    lines.push(
      ``,
      `Already authored here. Account for EACH of these tasks: \`kept\` when it stands`,
      `exactly as it is, re-sent under its own id when its steps changed, \`retired\``,
      `with the reason when its control is gone. A draft that leaves one out is refused.`,
      ...existing.map((id) => `  ${id}`),
    )
  }
  lines.push(
    ``,
    `Existing resource definitions, including readable facts. Reuse ids and owning places.`,
    JSON.stringify([place, ...nested], null, 2),
    `Return resource enrichments even when no new task is needed (interfaces: []).`,
    `Every place you declare states all four readable kinds — markers, elements,`,
    `controls, rows — unless an earlier session already established that kind here.`,
    `[] establishes none; an omitted kind is refused, because nothing comes back to it.`,
  )
  if (ownTaskContext) lines.push('', ownTaskContext)
  if (sourcePack) lines.push('', sourcePack)
  if (live) {
    lines.push(
      ...liveScreenLines({
        live: live.screens,
        ...(address ? { address } : {}),
        ...(live.observation ? { observation: live.observation } : {}),
      }),
    )
  }
  lines.push(...nestedLines(place.id, nested))
  lines.push(...screenLines(screens))
  lines.push(...registryLines(states))
  lines.push(
    ``,
    sourcePack
      ? `Start with the supplied source and its coverage manifest. Continue partial files before drawing conclusions about their`
      : context
      ? `Start from the module above and the modules it renders. Then account for their`
      : `Start by finding the module that renders this place. Then account for its`,
    `controls and rendered content, including conditional content and repeated rows.`,
    ...(live
      ? [
          `Read the live tree against the source: every control the tree lists is a control to account for,`,
          `and every handler the source attaches is a task to author, with the tree's names as its targets.`,
        ]
      : []),
  )
  return lines.join('\n')
}

/**
 * The derived context, stated with its limits. Each block is one AST fact:
 *
 * - `module` is exact — the routing tree names this file as the place.
 * - `renders` is a bounded import walk, so it is a starting set and not a
 *   boundary: the source is still what says which components a screen shows.
 * - `api` are the requests the closure makes — HTTP calls and RPC procedures
 *   alike — joined to catalog ids.
 * - `calls` are the RPC procedures that joined to NO id.
 *
 * The last two are stated together because the honest answer is often the second
 * one: "which api id does this screen's save button call" has the answer "none
 * the catalog carries, it calls `apiToken.create`", and a session told that
 * stops looking. A session not told it spent six turns guessing.
 */
function contextLines(context: WebPlaceContext): string[] {
  const lines = [...block('module', [context.module]), ...block('renders', context.renders)]
  if (context.renders.length > 0 && context.closure > context.renders.length + 1) {
    lines.push(`${GUTTER}(${context.closure - 1} modules in the import closure; these are the views)`)
  }
  lines.push(...block('api', context.apiEffects), ...block('calls', context.rpcCalls))
  lines.push(
    ``,
    ...(context.apiEffects.length > 0
      ? [
          `The api ids above are the server calls this screen's modules make, joined to`,
          `the catalog — an http request by path, a tRPC procedure by name. Use them for`,
          `\`apiEffects\`, and only add one you READ.`,
        ]
      : [
          `No request this screen's modules make joined to an api interface, so the`,
          `honest \`apiEffects\` is to omit the field unless you READ the call yourself.`,
        ]),
  )
  if (context.rpcCalls.length > 0) {
    lines.push(
      `The \`calls\` are tRPC procedures the catalog does NOT define — the derivation`,
      `maps a router tree only where an adapter states its mount, so these have no id`,
      `and cannot go in \`apiEffects\`. A procedure that DOES have one is already in`,
      `\`api\` above. They are here because they say what this screen's controls do.`,
    )
  }
  if (context.unjoined.length > 0) {
    lines.push(
      `Requests this screen makes that no api interface declares:`,
      ...context.unjoined.map((line) => `  - ${line}`),
    )
  }
  lines.push(
    `The module and the walk are AST facts: the routing tree declares that file at`,
    `this address, and the modules under it are what it imports. Which controls the`,
    `screen shows is NOT a fact here — read the source for that. And if the module`,
    `turns out not to render this screen at all (a monorepo's demo app can declare`,
    `the same address), author nothing and say so in \`unresolved\`.`,
    ``,
  )
  return lines
}

/**
 * What a shared component's session is told about the place it authors: that
 * it is shared, where it is rendered from, and that its tasks are performed
 * wherever it is rendered — one session instead of one per screen.
 */
function componentLines(placeId: string, component: NonNullable<PlaceBriefingInput['component']>): string[] {
  const screens = component.screens.slice(0, MAX_RENDERING_SCREENS)
  return [
    `This place is a SHARED COMPONENT: \`${component.module}\`, rendered by ${component.screens.length} screen(s)`,
    `(${screens.join(', ')}${component.screens.length > screens.length ? ', …' : ''}). It is authored ONCE, here: every`,
    `control it owns is a task \`at: "${placeId}"\` — the menu it opens, the dialog it shows,`,
    `the close button of its modal — and no screen session authors them again.`,
    `Its tasks run wherever it is rendered, so their steps must not depend on which`,
    `screen that is: \`entry.path\` names the screen you observe it at, and nothing more.`,
    component.address
      ? `Observe it at \`${component.address}\` (or at any screen above).`
      : `Every screen that renders it carries a slot: fill one from a seeded fixture to observe it.`,
    ``,
  ]
}

/** How many rendering screens a component's briefing names. */
const MAX_RENDERING_SCREENS = 12

/**
 * The shared places this place renders. Their controls are authored by their
 * own sessions: a session here references their tasks and never re-authors
 * them, and does not report them in `unresolved`.
 */
function sharedPlaceLines(shared: readonly SharedPlaceBrief[]): string[] {
  if (shared.length === 0) return []
  return [
    ``,
    `The SHARED places this one renders. They are authored ONCE, in sessions of their`,
    `own, as places of kind \`component\`: do NOT author their controls here, do not`,
    `declare them, and do not list them in \`unresolved\` — reference them instead`,
    `(a task here may leave the user at one with \`to\`, and a scenario runs their tasks`,
    `on this screen). What they already carry:`,
    ...shared.map((place) =>
      `  ${place.id}  ·  ${place.title}  ·  ${place.tasks.length > 0 ? place.tasks.slice(0, MAX_SHARED_TASKS_BRIEFED).join(', ') + (place.tasks.length > MAX_SHARED_TASKS_BRIEFED ? `, … ${place.tasks.length - MAX_SHARED_TASKS_BRIEFED} more` : '') : '(authored in its own session)'}`,
    ),
  ]
}

/** How many of a shared place's tasks a briefing names. */
const MAX_SHARED_TASKS_BRIEFED = 20

/**
 * The places already on this one: what `of` names, and what a session must not
 * declare a second time under a new id. A dialog authored by an earlier session
 * of this place — or by the derivation — is the same dialog.
 */
function nestedLines(
  placeId: string,
  nested: readonly InterfaceResource[],
): string[] {
  if (nested.length === 0) return []
  return [
    ``,
    `The places already on this one. Use these ids in \`at\` and \`to\`; declare a new`,
    `place in \`resources\` only when none of them is the one you mean:`,
    ...nested.map((place) => `  ${place.id}  ·  ${place.kind}  ·  ${place.title}`),
    `(all of them sit \`of: "${placeId}"\`.)`,
  ]
}

/**
 * Every screen the catalog knows, id and address. This is the whole of what a
 * task's `to` may name — a task that moves the user leaves them at a SCREEN or
 * at a place on one, and both resolve here. Capped like the registry: a listing
 * whose tail is counted is a fact, a listing silently cut in half is not.
 */
function screenLines(screens: readonly { id: string; address?: string }[]): string[] {
  if (screens.length === 0) return []
  const shown = screens.slice(0, MAX_SCREENS_BRIEFED)
  const width = Math.max(...shown.map((screen) => screen.id.length))
  const lines = [
    ``,
    `Every screen this catalog knows. A task that MOVES the user names one of these`,
    `ids in \`to\`; an address is where a screen is reached, exactly as it is written:`,
    ...shown.map((screen) => `  ${screen.id.padEnd(width)}  ${screen.address ?? '—'}`),
  ]
  if (screens.length > shown.length) {
    lines.push(
      `  … ${screens.length - shown.length} more — the whole list is the \`resources.web\` of`,
      `  \`.truecourse/guard/interfaces.json\`, which \`read_file\` reads.`,
    )
  }
  return lines
}

/** How many screens one briefing states before the tail counts the rest. */
const MAX_SCREENS_BRIEFED = 250

/**
 * The state registry as the session sees it: every world the catalog names, its
 * id and its one line. The registry is small by design — reuse is what keeps it
 * so — but a repository whose registry has run away should not swamp a session's
 * context, so it is capped, and the tail says where the rest is rather than
 * pretending there is none.
 */
function registryLines(states: readonly InterfaceState[]): string[] {
  if (states.length === 0) return []
  const shown = states.slice(0, MAX_STATES_BRIEFED)
  const width = Math.max(...shown.map((state) => state.id.length))
  const lines = [
    ``,
    `The worlds this catalog already names. A state id means the SAME world at`,
    `every place, which is how a task at one place chains to a task at another:`,
    ...shown.map((state) => `  ${state.id.padEnd(width)}  ${state.description}`),
  ]
  if (states.length > shown.length) {
    lines.push(
      `  … ${states.length - shown.length} more — the whole registry is the \`states\` of`,
      `  \`.truecourse/guard/interfaces.authored.json\`, which \`read_file\` reads.`,
    )
  }
  lines.push(
    `Reuse an id above whenever it names the world your task assumes or leaves.`,
    `Define a new one in \`states\` only when none of them does, and never restate`,
    `an id above with different words — that changes what every task chained to`,
    `it asserts.`,
  )
  return lines
}

/** How many registry entries one briefing states. */
const MAX_STATES_BRIEFED = 200

/** One labelled block of the briefing table: `label  first`, the rest aligned under it. */
function block(label: string, values: readonly string[]): string[] {
  if (values.length === 0) return []
  return values.map((value, index) => (index === 0 ? `  ${label.padEnd(9)}${value}` : `${GUTTER}${value}`))
}

/** The column every value in the briefing table starts at — `place`/`address`'s. */
const GUTTER = ' '.repeat(11)

const SYSTEM_PROMPT = `You author WEB INTERFACES for TrueCourse: the catalog of what a user can do and read in an application's UI, read off the application's own source.

# What you are producing

One INTERFACE is ONE TASK a user can perform from one state — "silence a rule from a violation card", "filter the violation list by category", "open a repository's report". It is never a page inventory, never a list of every button, and never two independent tasks stitched into one sequence.

A user task carries \`purpose: "task"\`. Its supporting interactions carry
\`purpose: "control"\` and use the SAME executable interface schema. Keep task
boundaries, but do not omit actions needed to exercise their branches:
- Cancel add/edit/delete dialogs as separate control interfaces. Include opening
  the dialog before cancelling when needed, and scope duplicate button names to
  the owning dialog. Cancelling preserves the existing record state.
- Previous/next page, sorting, filters, and other supported controls that change
  which results the user sees. Record preconditions such as another page existing.
- Source-backed error recovery and navigation actions.

Readables describe what can be asserted. A readable button is NOT an executable
action: every source-established interaction needs steps as well as any readable
states. Never synthesize an action from a readable locator alone. Read the handler
and record its real behavior. Preserve native selection mode, container scope,
startingState/endState and at/to. Do not invent actions for uninspected controls;
record those omissions in unresolved.

Each task carries:

- \`id\` — \`web/<kebab-slug>\`, named for the task ("web/silence-rule-from-violation-card").
- \`title\` — what the user accomplishes, in their words. One line.
- \`group\` — the family it sits in (the screen's area: "repos", "home", "settings").
- \`entry\` — \`{"method": "GET", "path": "<address>"}\`. The address is where the task is performed, exactly as the routing declares it, with \`{param}\` slots.
- \`steps\` — the ordered interactions, and ONLY the ones that make up this task:
  - \`{"kind": "navigate", "route": "/repos/{repoId}"}\` — moving to an address.
  - \`{"kind": "activate", "target": {"role": "button", "name": "Analyze"}}\` — a click, a tap, a submit.
  - \`{"kind": "input", "target": {"role": "textbox", "name": "Repository path"}}\` — putting a value in a field.
  - \`{"kind": "press", "key": "Enter", "target": {"role": "searchbox", "name": "Search"}}\` — a key the task depends on: a search that submits on Enter, a menu or drawer that closes on \`"Escape"\` (no \`target\`: the key goes to whatever has focus). \`key\` is one of Enter, Escape, Tab, ArrowUp, ArrowDown, ArrowLeft, ArrowRight. Only when the source handles the key (an \`onKeyDown\` for it, a form that submits); a click that does the same thing is an \`activate\`.
  - \`{"kind": "hover", "target": {"role": "row", "name": "Inbox"}}\` — moving the pointer over an element, when the control the task needs shows only under the pointer (a row's delete button styled visible on hover): the hover, then the \`activate\` of the revealed control.
  - \`{"kind": "upload", "target": {"label": "Import file"}, "file": {"text": "url\\nhttps://example.com", "as": "links.csv"}}\` — handing a file to the control a user operates to pick one (its label, its button — never \`css\`: the hidden file input behind a styled button is not what a user operates). \`file\` names exactly one byte source: \`text\` for bytes a reader can read (a CSV or an HTML export to import), \`base64\` for a binary the seed publishes — \`{"base64": "{{fixture:<fixture>.<field>}}", "as": "photo.png"}\` with a fixture field the briefing lists — and \`as\` for the file name the app sees. With no fixture to name and no text that fits, the upload task goes in \`unresolved\`. \`check_draft\` never replays an upload.
- For a native HTML \`<select>\`, record an \`input\` with \`mode: "select"\`. Its target is the field's role/name (usually combobox); generation chooses an option by visible label. Use \`mode: "fill"\` for editable text controls, including editable comboboxes. Custom non-editable menus use activate steps to open the menu and choose the option. Read the rendered control before deciding.
- A press, hover or upload step takes \`target\`, \`within\` and a \`css\` target's \`why\` exactly as an activate does, and is proven live the same way (an upload's target is never \`css\`). \`observe_screen\`'s \`activate\` and a \`proof\`'s \`steps\` take \`{"press": "<key>", "on": <locator>}\` and \`{"hover": <locator>}\` beside clicks, so a state only a key or a hover reaches can be read and proven.
- An input or activate step inside a dialog/panel can carry \`within: { "role": "dialog", "name": "Delete expense", "exact": true }\`, or \`within: {"css": …}\` with a \`why\` when the container has no role (see rule 1). Use the actual container to distinguish a confirmation button from the page's identically named opener, or a page control from the sidebar's control of the same name. Do not rely on the first match when only one of them serves the task.
- \`at\` — the place the task is performed at: this place, or a dialog or panel on it. **The briefing lists both** — the places already on this one, and every screen the catalog knows.
- \`to\` — the place it leaves the user at, ONLY when it moves them. A task that acts in place carries \`at\` alone.
- \`startingState\` / \`endState\` — ids from the state registry: the world the task assumes, and the world it leaves. **The briefing lists the registry — reuse an id from it before you mint one**, and mint only when no id there names that world. **A task that CHANGES the world states its \`endState\`** — anything that creates, edits, deletes, enables, invites or cancels leaves a world different from the one it found, and that difference is what a scenario asserts. Omit \`endState\` only for a task that leaves the data exactly as it was (a navigation, a filter, a read).
- \`principal\` — WHO performs the task, only when it is not the default principal: the name of another principal the briefing lists, chosen by its description (the user the task's control or state belongs to), or \`"anonymous"\` for a task done signed out (a login, a sign-up, a password reset form). Its live proof runs as that principal, and a scenario of the task starts from that session. Omit it for a task the default principal performs.
- \`apiEffects\` — the ids of the api interfaces the task's steps call. **The briefing already states them**: the requests this screen's own modules make, joined to the catalog by path. Use those ids, add one only if you READ the call yourself, and when the briefing joined nothing, omit the field — do not go looking for an id with \`list_interfaces\` guesses. \`[]\` means the task reaches no server at all, which is a stronger claim than omitting. Never guess.

# The rules that are checked

1. **Locators, in this order of preference.** Every step \`target\` is an object naming ONE handle — never a selector string, an XPath or a test id:
   - **Accessible, always first** — \`{"role": "button", "name": "Add Repository"}\`: \`role\` is one of the ARIA roles the target schema enumerates, \`name\` the element's accessible name, written plainly with no quoting of any kind. Add \`"exact": true\` only when one name is a prefix of another.
   - **Visible text or attribute** — \`{"title": "More"}\`, \`{"label": "Email"}\`, \`{"placeholder": "Search"}\`, \`{"text": "Show all"}\`, \`{"alt": "Logo"}\`: for a control with no role+name that a user can still identify on the screen. **An option or item with visible text and no role** — a react-select option rendered as a plain \`div\`, a click-handled card, a list entry — is targeted by \`{"text": "<its text>"}\`: that is canonical, and it comes before \`css\`. The observation lists such elements as clickable elements with no role, with their text.
   - **CSS, last** — \`{"css": "button[data-testid=\"sort\"]"}\` or \`{"css": "main button:has(svg[data-icon=\"close\"])"}\`: only when neither of the above reaches the control (an icon-only button with no label, two controls sharing one tooltip). A step with \`css\` in its target or its \`within\` is NON-CANONICAL: it carries \`"why"\` on the step — one line saying what the control is and why nothing accessible reaches it ("icon-only button, no aria-label; SortDropdown.tsx renders an <svg data-icon=\"sort\">") — it is proven on the live screen by \`check_draft\`, and it is recorded as a non-canonical locator. Within css, prefer a stable attribute (\`title\`, \`data-*\`, \`aria-*\`, the icon's class), then position inside a landmark or named region (\`main …\`, \`nav[aria-label="Sidebar"] …\`), then bare position; NEVER a generated utility class (Tailwind utilities, CSS-module hashes). Copy a selector from the observation's list of unnamed controls rather than composing one. With no live screen, \`css\` is refused: name the control in \`unresolved\` instead.
   - \`pick\` resolves a KNOWN ambiguity by position: \`"first"\` when any of the matches serves, or a 1-based number (\`"pick": 2\`) for the one you mean. It keeps a locator canonical, and \`check_draft\` proves the position exists on the live screen — use it only when you know which match is the intended control (the unnamed-controls list says \`this is #n\`).
   - \`within\` scopes a step to one container and takes any handle, a role always with its name: \`{"role": "dialog", "name": "Delete expense"}\`, \`{"role": "navigation", "name": "Sidebar"}\`, or \`{"css": "main"}\` (non-canonical, so \`why\` is needed). **An unnamed container is still a container**: a modal drawn with no \`role="dialog"\` and no name, a card, a panel made of plain \`div\`s is scoped with \`within: {"css": "<selector>"}\` and a \`why\` — copy the selector from the observation's list of overlays with no dialog role. A modal's Cancel, Confirm and close steps are scoped this way, never left unscoped or unauthored because the modal has no role.
   - **How \`check_draft\` reaches a control it proves** (a \`css\` or \`pick\` step): it opens the task's entry and, when every step before the proven one is a click and the task leaves the world as it found it (no \`endState\`), replays those clicks. Otherwise — an \`input\` comes first, or the task changes the world — it cannot replay the task, and you pass \`proof: {"<task id>": {"steps": [...]}}\`: the actions, in order, that bring the page to the control — \`{"activate": <locator>}\`, \`{"fill": <locator>, "value": "<text>"}\`, \`{"select": <locator>, "option": "<visible label>"}\`. A proven control is resolved right before the list acts on it, else once the list ends. **Never list a control that submits, deletes, cancels or signs out**: the world is the seed's and the tests need it intact. When the entry carries a \`{slot}\`, add \`"path"\` with every slot filled from a seeded fixture — the same route, filled.
   **When the briefing carries THE LIVE SCREEN, its accessibility tree is the authority on names**: a control the tree lists as \`button "Save"\` is authorable as exactly that pair whatever the source spells (an \`aria-label\`, a value-built name, a translated string all resolve there), and a control the source renders that the tree does not list is conditional — observe the state that shows it, or say in \`unresolved\` which state you could not reach. A control the tree lists with no name (\`button ""\`, or a lone icon glyph) is still a control: target it by the next handle down this list, never skip it.
2. **A task is reachable.** Either it says where it happens (\`at\`), or its first step navigates to its entry address.
3. **The entry is the address the task starts at.** When the first step navigates, \`entry.path\` equals that route; when the task is \`at\` a place, \`entry.path\` is the address of the screen that place sits on.
4. **One task, one entry.** Two tasks with the same entry and the same steps are one task. Never author a task the existing catalog already defines; compare exact steps with \`get_interfaces\`.
5. **A state is a WORLD, not a place.** "a rule is silenced" is a state; "the rules dialog is open" is a place — that belongs in \`at\`/\`to\`. Every state id you reference is defined once — either it is already in the registry the briefing lists, and you reference it and define nothing, or it is new and you define it in \`states\` with one line saying what world it names. Redefining a registry id with different words is refused: other places' tasks already chain to it.
6. **Nothing is guessed.** Every step target, every route, every api effect comes from something you READ in the source. What you cannot establish goes in \`unresolved\`, one line each.
7. **An opener is not a task on its own.** A task whose \`to\` is a dialog or a panel opens it — so READ the component it opens (the modal, the drawer, the picker) and author what a user does there, cancelling and closing included, \`at\` that place, in the same \`check_draft\` call as the opener. When its controls truly cannot be authored, an \`unresolved\` line naming the place (its id or its title) and why stands in for them. \`check_draft\` refuses an opener that has neither.

# What the page shows

Author readable facts in each owning resource's \`readables\`, including the existing derived screen. Return the screen with its existing id, kind, title and address; add panels/dialogs with \`of\` naming their actual parent. Follow the rendered component tree, including nested dialogs, tab panels, shared controls and translation files. Put a fact on its innermost owning place once; screen details aggregate nested places automatically. Enrichment must not move or reparent existing places.

Use the shared readable and locator schemas supplied in the outcome:
- \`markers\`: stable visible text, e.g. {"id":"empty-list","marker":"No documents found","when":"the document list is empty"}. Optional \`within\` scopes the text. Do not record a current user's data, a sample count, or an i18n key as a stable marker.
- \`elements\`: non-interactive visible elements, e.g. {"id":"page-heading","element":{"role":"heading","name":"Documents"}}.
- \`controls\`: states the source exposes, e.g. {"id":"include-archived","control":{"role":"checkbox","name":"Include archived"},"states":["checked"]}. State names are checked, pressed, selected, expanded, disabled. Declare exposure, never a presumed state value. Read the component implementation to establish native or ARIA state support.
- \`rows\`: the repeated item's actual rendered text as a template, e.g. {"id":"document-row","item":"row","template":"<title> <status>","slots":[{"name":"title","kind":"text"},{"name":"status","kind":"enum","values":["Draft","Signed"]}],"when":"documents exist"}. Name every varying slot; use count only for numeric counts and enum only when source establishes the whole rendered set. Use the real item role, not row for an arbitrary div: repeated items that are plain \`div\`s (cards, member rows) are \`"item": "generic"\` inside a \`within\` that reaches their container. Add \`within\` only for a container you observed or read. Do not invent a table name for an unnamed table.

Readable locators use the same order of preference as step targets: role/name first, then label, placeholder, text, title or alt, and \`css\` LAST — never XPath or a test id as a handle. A readable that uses \`css\` (in its locator or its \`within\`) is NON-CANONICAL exactly like a step: it carries \`"why"\` on the fact, \`check_draft\` proves it on the live screen at this place's address (a fact of a dialog or panel is read after the actions you list in \`proof: {"<place id>": {"steps": [...]}}\` that open it), and it is recorded as a non-canonical locator. An unnamed checkbox, an icon-only toggle that exposes a state, a card list with no list role are declared this way rather than left out. Use \`when\` to state source conditions, including permissions, loading, empty states and selected tabs. Readable ids are optional; reuse existing ids and keep new names stable within the owning resource.

Every place you declare states ALL FOUR kinds: \`markers\`, \`elements\`, \`controls\`, \`rows\`. An explicit [] means you established that it has none of that kind, and the write path REFUSES a place that leaves a kind unstated — nothing returns to this screen once your outcome is accepted until its source changes, so an omitted kind stays unknown. Read the place well enough to answer for each kind; where you truly cannot, say what you could not inspect in \`unresolved\` and still state the kind. Never fill arrays just to populate a table, and never mark uninspected content empty. Existing kinds established by an earlier session of this screen are preserved when you omit them; a supplied kind replaces that kind, so include its surviving established facts. Readables alone are a valid outcome with \`interfaces: []\`. They do not require a new task or changed task steps.

Every fact must come from source you READ (or source already provided in the briefing pack), or from a screen you OBSERVED with \`observe_screen\` when the run offers it. Use the session's read_file/search_repo tools for evidence, and run check_draft on the resource facts as well as the tasks. Without \`observe_screen\` these tools provide source evidence only; do not claim to have inspected runtime state you did not observe.

# Shared components

UI that several screens render — a layout's sidebar and top bar, a list's card actions, a search modal, a modal's close button — is a SHARED COMPONENT: a place of kind \`component\` that is authored once, by its own session. When the briefing names shared places this place renders, their controls are not yours: reference their tasks, never author or declare them again, and never write an \`unresolved\` line about them. When the briefing says THIS place is a shared component, author every control it owns \`at\` it, with steps that hold on any screen that renders it.

# The live screen

When the briefing carries THE LIVE SCREEN, the app is running and a browser is signed in as the default principal; the briefing lists every principal the run can observe and act as, with what makes each distinct, and says when the default principal was sent away from this address. WHOSE screen and whose task it is, is yours to decide from the source and those descriptions: observe as that principal (\`observe_screen\` with \`principal\`) and name it on the tasks it performs. When no principal reaches an address at all, \`check_draft\` says so by accepting a \`css\` written from source there UNPROVEN; when some other principal reaches it, the refusal names which. The briefing already holds the accessibility tree of this place's address (for an address with no slot); \`observe_screen\` opens any address again, with the slots filled from the seeded fixtures the briefing lists, and may \`activate\` up to five targets first — the way to read a dialog, a menu or a tab panel that only exists once opened. Read the tree and the source TOGETHER: the tree gives every control its real role and name and shows which of them are rendered in this state, and the observation lists every control the tree shows with no name — with its attributes, its icon, its region and a candidate css selector with its match count; the source gives what each control does (its handler, the request it makes, the state it leaves), which no tree can say. A control in the tree with no handler you could read goes in \`unresolved\` with its name; a handler in the source whose control is in no tree you observed goes there too, naming the state you could not reach. Never activate a control that submits a form, deletes, cancels or signs out: the world is the seed's and the tests will need it intact.

# Findings — what the repository says that the source does not do

\`findings\` is the fragment's other list, and it is NOT \`unresolved\`. \`unresolved\` is what YOU could not establish. A finding is a CONTRADICTION you DID establish: it has TWO NAMED SIDES — what one artifact CLAIMS, and what the other SHOWS — and one of the two must be wrong. A statement with one side is not a finding, whatever it observes. The findings ledger is committed and append-only, so a non-finding in it is noise that compounds forever.

Record a finding when:

- a doc, a README or a comment describes a control, an address or a flow the source does not have, or has under a different name;
- the briefing's derived facts disagree with the source you read — the module declared at this address does not render this screen, an api id joined to this screen's requests is not the endpoint the module calls;
- two documents about this screen say different things.

Write each one as ONE line that quotes BOTH sides and names its files, the way the code-vs-docs ledger does. Verbatim, not paraphrased — a human reads these against the source, and a summary cannot be checked.

Real examples, from past runs. Findings — two sides, both named:

- \`docs/organisations/email-domains.mdx says click "Verify" to confirm a domain; the domains table component renders a button named "Sync"\` — the doc claims one control, the source shows another.
- \`the briefing says /signin renders apps/remix/app/components/forms/signup.tsx; signin.tsx imports only SIGNUP_ERROR_MESSAGES from it and renders <SignInForm />\` — the derived fact claims one thing, the module shows another.

NOT findings — one side, nothing contradicted:

- \`no additional task controls are present on this screen\` — that is the ABSENCE of a finding; an empty (or complete) task list already says it. Report nothing.
- \`the audit-log table renders no interactive controls\` — a statement that nothing further exists. If it means "this place has no authorable control", that is \`unresolved\`, the channel that already holds exactly that.

The catalog follows the CODE regardless: author the task as the source has it, and record the disagreement. Do not record your own uncertainty (that is \`unresolved\`), a style opinion, a missing test, or anything you did not read on both sides. A screen whose docs agree with its source has no findings, which is the normal outcome.

# How to work

- The BRIEFING already names the module that is this place and the modules it renders. Use supplied complete source first and follow continuations for partial files; \`search_repo\` is for what they lead to, not for finding them again.
- The PLACES are in the briefing — every screen with its address, and the dialogs and panels on this one. There is no tool for them: what the briefing states is what the catalog has.
- \`search_interfaces\` and \`get_interfaces\` — paged web catalog metadata and compact exact action definitions. Request includeResources only when you need their readable details. Follow nextCursor until required fields are complete; restart if those results changed. Use get_resources and get_states for exact registry definitions. Do not use source search to find hidden catalog files.
- \`list_interfaces\` — API/CLI summaries, including confirming a known API id. Web duplicate checks use the paged catalog tools.
- \`observe_screen\` — the RUNNING app's accessibility tree at an address, signed in. Offered only when the run booted the app; the briefing says so. Fill every slot; \`activate\` opens what the tree does not show closed.
- \`search_repo\` uses real glob paths such as **/*.tsx; pathContains is a literal path filter. Distinguish no matching files from no matching content. \`read_file\` reads one source span; use \`read_files\` for independent known paths or continuations in one bounded request. Complete source units include their branches; inspect explicitly omitted units when needed. The accessible names are in JSX (\`aria-label\`, button text, label elements); when a name is an i18n key, the locale file holds the rendered string.
- **This place's existing tasks**, when the briefing lists any, are yours to reconcile, not to re-invent. Read each against the source (and the live screen when you have it): list one that still holds exactly in \`kept\` by id (do not re-send it: a kept task stays byte for byte, and every scenario grounded on it with it), re-send one whose steps changed under its SAME id, and put one whose control is gone in \`retired\` with one line saying why. Then author what is new. \`check_draft\` refuses a draft that leaves an existing task unaccounted for.
- \`check_draft\` — the exact rules the write path enforces, run against a draft. **Run it EARLY and run it SMALL**: as soon as you have read the briefing's module, draft the first task or two and check just those, before you read anything further. A misreading — the wrong address, a target the schema refuses, a task located at another screen — comes back in one turn instead of at the outcome, where a fragment that breaks a rule is dropped whole and the place is left with nothing.
- **What check_draft accepts, it KEEPS.** The draft is built up across calls: each call carries only the interfaces, states, places, unresolved lines and findings it is about, and the tool checks them against the catalog AND against everything already accepted in this session. **Never resend an interface that was accepted** — send its id again only to CORRECT that entry, in which case the new version replaces it. Every tool result names the ids the draft holds. A state stays in the draft only while one of its tasks references it, so renaming a world is a matter of re-sending the task and the new state together. A single whole-draft call still works; it is simply the largest, most fragile way to send one, and a reply that grows past the model's output limit is lost entirely.
- When everything you authored has been accepted, finish with outcome: {"draftId":"the exact id the last accepted check returned"}. Do not regenerate its JSON. The engine restores the accepted tasks, states, resources, unresolved and findings from this session and validates them against the current catalog. If corrections are needed, check the corrected pieces and finalize the new id.

# What good looks like

A screen with a list, a filter, and a detail action yields three or four tasks, each one thing a user came to do. A screen you could not locate in the source yields ZERO tasks and one line in \`unresolved\` naming what you looked for. Both are correct outcomes; a plausible-looking task nobody can run is not.`
