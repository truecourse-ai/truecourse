/**
 * THE AUTHORING SESSION — `guard-interfaces.web-tasks`, one session per PLACE.
 *
 * AGENTIC_PIPELINE_PLAN §3.2 makes the agent loop the pipeline's only LLM call
 * shape, and this is the first stage built on it: the session reads the app's
 * own source for one screen, and hands back the tasks a user can perform there.
 *
 * WHY THE PLACE IS THE WORK ITEM. A web task is "one task from one state"
 * (§10.4), and the state a task starts from is a place plus a world. Scoping a
 * session to one screen gives it a bounded reading job (that screen's route
 * module and the components it renders), a natural done-condition (the controls
 * of that screen are accounted for), and a work item that re-runs
 * independently: authoring one place again re-authors nothing else. It also
 * matches how the derivation now works — item 103 derives the places, so the
 * work list is a fact about the repository rather than a plan somebody typed.
 *
 * The done-condition is the OUTCOME, and the outcome is a fragment that
 * {@link validateFragment} accepts. A session that cannot state a task from what
 * the source says returns zero tasks and says why in `unresolved` — an empty
 * honest fragment is a result, not a failure.
 */

import type { SessionBudget, SessionDef } from '@truecourse/agent-loop'
import type { WebPlaceContext } from '@truecourse/interface-mapper'
import type { InterfaceState, InterfacesFile } from '@truecourse/shared'
import { AuthoredFragmentSchema, type AuthoredFragment } from './draft.js'
import { buildAuthorTools } from './tools.js'

export const INTERFACE_AUTHOR_SESSION_KIND = 'guard-interfaces.web-tasks'

/**
 * The three numbers (§3.3). Reading one screen's JSX is a handful of searches
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

export interface AuthorSessionInput {
  repoRoot: string
  derived: InterfacesFile | null
  authored: InterfacesFile | null
  /** Ids of the prior authored tasks at this place — the ones a re-author may replace. */
  replaceable: ReadonlySet<string>
  /** The place this session authors — every task it hands back is located there. */
  scope?: { screenId: string; address?: string }
}

export function interfaceAuthorSessionDef(input: AuthorSessionInput): SessionDef<AuthoredFragment> {
  return {
    kind: INTERFACE_AUTHOR_SESSION_KIND,
    systemPrompt: SYSTEM_PROMPT,
    tools: buildAuthorTools(input),
    outcomeSchema: AuthoredFragmentSchema,
    budget: INTERFACE_AUTHOR_BUDGET,
    // The structural half of "run check_draft" (01 step 2k). The prompt already
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
        'Outcome refused: you never ran `check_draft` in this session. Call `check_draft` on your complete draft now — it runs the exact validation the write path will run, so a problem it finds costs one turn to fix here instead of the whole fragment at the outcome. Fix anything it reports, then call `outcome` again.',
    },
  }
}

/** The work item, as the session index and the transcript record it. */
export function placeWorkItem(placeId: string): string {
  return `web:${placeId}`
}

export interface PlaceBriefingInput {
  place: { id: string; title: string; address?: string; kind: string }
  /** Ids of the tasks already authored at this place. */
  existing: readonly string[]
  /** What the AST pass knows about this place (item 105), when it knows anything. */
  context?: WebPlaceContext
  /** The worlds the catalog already names — the ids this session reuses. */
  states: readonly InterfaceState[]
  /** Every screen the catalog knows, in catalog order — what `to` may name. */
  screens: readonly { id: string; address?: string }[]
  /** The dialogs and panels that sit on THIS place — what `of` already names. */
  nested: readonly { id: string; kind: string; title: string }[]
}

/**
 * The opening message: which place, at which address, what the AST pass already
 * knows about it, what is already authored there, and which worlds the catalog
 * already names.
 *
 * The context block (item 105) is the difference between a session that reads and
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
 * The PLACES are here for a third reason on top of those two (item 9): they were
 * a tool, and a tool result is re-sent on every turn that follows it while a
 * briefing sits in the prefix a provider caches. Only the two facts a draft
 * actually resolves against are stated — the screens with their addresses, which
 * is what `to` may name, and the places on THIS one, which is what `of` names.
 */
export function placeBriefing({
  place,
  existing,
  context,
  states,
  screens,
  nested,
}: PlaceBriefingInput): string {
  const lines = [
    `Author the web tasks of ONE place.`,
    ``,
    `  place    ${place.id} (${place.kind})`,
    `  address  ${place.address ?? '— (this place has no address of its own; it sits on one)'}`,
    `  title    ${place.title}`,
    ``,
    ...(context ? contextLines(context) : []),
    `Every task you author is performed HERE: \`at: "${place.id}"\`, or at a dialog`,
    `or panel that sits on this place — declare any such place in \`resources\` with`,
    `\`of: "${place.id}"\`. Their \`entry.path\` is this place's address either way.`,
    `A task of another screen belongs to another session and will be refused.`,
  ]
  if (existing.length > 0) {
    lines.push(
      ``,
      `Already authored here — re-author these only if the source no longer matches them:`,
      ...existing.map((id) => `  ${id}`),
    )
  }
  lines.push(...nestedLines(place.id, nested))
  lines.push(...screenLines(screens))
  lines.push(...registryLines(states))
  lines.push(
    ``,
    context
      ? `Start from the module above and the modules it renders. Then account for their`
      : `Start by finding the module that renders this place. Then account for its`,
    `controls: which of them a user performs a TASK with, and which are decoration.`,
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
 * The places already on this one: what `of` names, and what a session must not
 * declare a second time under a new id. A dialog authored by an earlier session
 * of this place — or by the derivation — is the same dialog.
 */
function nestedLines(
  placeId: string,
  nested: readonly { id: string; kind: string; title: string }[],
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

const SYSTEM_PROMPT = `You author WEB INTERFACES for TrueCourse: the catalog of what a user can DO in an application's UI, read off the application's own source.

# What you are producing

One INTERFACE is ONE TASK a user can perform from one state — "silence a rule from a violation card", "filter the violation list by category", "open a repository's report". It is never a page inventory, never a list of every button, and never two independent tasks stitched into one sequence.

**What is NOT a task.** A task is something a user came to the screen to DO — it changes what the application knows, or where the user is, or which of the data they are looking at. A control that only re-renders the same data differently is not a task, however clickable it is:

- **Pagination** — next page, previous page, first, last, page size. Four of these authored as four tasks is the page inventory this design exists to refuse.
- **Sorting a column**, changing a table's density, expanding a row to show what is already loaded.
- **Chrome** — theme and language switchers, help popovers, tooltips, breadcrumb links back to a screen whose own tasks belong to that screen's session, "copy to clipboard" on a value the screen already shows.

A screen whose only controls are these has ZERO tasks, and that is a correct outcome.

Each task carries:

- \`id\` — \`web/<kebab-slug>\`, named for the task ("web/silence-rule-from-violation-card").
- \`title\` — what the user accomplishes, in their words. One line.
- \`group\` — the family it sits in (the screen's area: "repos", "home", "settings").
- \`entry\` — \`{"method": "GET", "path": "<address>"}\`. The address is where the task is performed, exactly as the routing declares it, with \`{param}\` slots.
- \`steps\` — the ordered interactions, and ONLY the ones that make up this task:
  - \`{"kind": "navigate", "route": "/repos/{repoId}"}\` — moving to an address.
  - \`{"kind": "activate", "target": "button \\"Analyze\\""}\` — a click, a tap, a submit.
  - \`{"kind": "input", "target": "textbox \\"Repository path\\""}\` — putting a value in a field.
- \`at\` — the place the task is performed at: this place, or a dialog or panel on it. **The briefing lists both** — the places already on this one, and every screen the catalog knows.
- \`to\` — the place it leaves the user at, ONLY when it moves them. A task that acts in place carries \`at\` alone.
- \`startingState\` / \`endState\` — ids from the state registry: the world the task assumes, and the world it leaves. **The briefing lists the registry — reuse an id from it before you mint one**, and mint only when no id there names that world. **A task that CHANGES the world states its \`endState\`** — anything that creates, edits, deletes, enables, invites or cancels leaves a world different from the one it found, and that difference is what a scenario asserts. Omit \`endState\` only for a task that leaves the data exactly as it was (a navigation, a filter, a read).
- \`apiEffects\` — the ids of the api interfaces the task's steps call. **The briefing already states them**: the requests this screen's own modules make, joined to the catalog by path. Use those ids, add one only if you READ the call yourself, and when the briefing joined nothing, omit the field — do not go looking for an id with \`list_interfaces\` guesses. \`[]\` means the task reaches no server at all, which is a stronger claim than omitting. Never guess.

# The rules that are checked

1. **Locators are roles and accessible names, never selectors.** Every \`target\` is \`<role> "<accessible name>"\` — \`button "Add Repository"\`, \`textbox "Repository path"\`, \`switch "Enable rule"\`. The role is a real ARIA role. If an element has no role and no accessible name, it is NOT authorable: say so in \`unresolved\` rather than inventing a locator.
2. **A task is reachable.** Either it says where it happens (\`at\`), or its first step navigates to its entry address.
3. **The entry is the address the task starts at.** When the first step navigates, \`entry.path\` equals that route; when the task is \`at\` a place, \`entry.path\` is the address of the screen that place sits on.
4. **One task, one entry.** Two tasks with the same entry and the same steps are one task. Never author a task \`list_interfaces\` already shows.
5. **A state is a WORLD, not a place.** "a rule is silenced" is a state; "the rules dialog is open" is a place — that belongs in \`at\`/\`to\`. Every state id you reference is defined once — either it is already in the registry the briefing lists, and you reference it and define nothing, or it is new and you define it in \`states\` with one line saying what world it names. Redefining a registry id with different words is refused: other places' tasks already chain to it.
6. **Nothing is guessed.** Every step target, every route, every api effect comes from something you READ in the source. What you cannot establish goes in \`unresolved\`, one line each.

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

- The BRIEFING already names the module that is this place and the modules it renders. Read those first; \`search_repo\` is for what they lead to, not for finding them again.
- The PLACES are in the briefing — every screen with its address, and the dialogs and panels on this one. There is no tool for them: what the briefing states is what the catalog has.
- \`list_interfaces\` — what is already catalogued (web ids so you never author a duplicate; the api list is there to confirm an id, not to hunt for one).
- \`search_repo\` and \`read_file\` — the application's source. The accessible names are in the JSX (\`aria-label\`, button text, label elements); when a name is an i18n key, the locale file holds the string a user actually reads.
- \`check_draft\` — the exact rules the write path enforces, run against a draft. **Run it EARLY**: as soon as you have read the briefing's module, draft the first task or two and check them, before you read anything further. A misreading — the wrong address, a locator shape that is refused, a task located at another screen — comes back in one turn instead of at the outcome, where a fragment that breaks a rule is dropped whole and the place is left with nothing. Then run it again on the complete draft, before you produce the outcome.
- Then produce the outcome: the tasks, any new states, any place the catalog is missing, \`unresolved\`, and \`findings\`.

# What good looks like

A screen with a list, a filter, and a detail action yields three or four tasks, each one thing a user came to do. A screen you could not locate in the source yields ZERO tasks and one line in \`unresolved\` naming what you looked for. Both are correct outcomes; a plausible-looking task nobody can run is not.`
