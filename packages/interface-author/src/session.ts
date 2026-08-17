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
import type { InterfacesFile } from '@truecourse/shared'
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
  }
}

/** The work item, as the session index and the transcript record it. */
export function placeWorkItem(placeId: string): string {
  return `web:${placeId}`
}

/** The opening message: which place, at which address, and what is already there. */
export function placeBriefing(place: {
  id: string
  title: string
  address?: string
  kind: string
}, existing: readonly string[]): string {
  const lines = [
    `Author the web tasks of ONE place.`,
    ``,
    `  place    ${place.id} (${place.kind})`,
    `  address  ${place.address ?? '— (this place has no address of its own; it sits on one)'}`,
    `  title    ${place.title}`,
    ``,
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
  lines.push(
    ``,
    `Start by finding the module that renders this place. Then account for its`,
    `controls: which of them a user performs a TASK with, and which are decoration.`,
  )
  return lines.join('\n')
}

const SYSTEM_PROMPT = `You author WEB INTERFACES for TrueCourse: the catalog of what a user can DO in an application's UI, read off the application's own source.

# What you are producing

One INTERFACE is ONE TASK a user can perform from one state — "silence a rule from a violation card", "filter the violation list by category", "open a repository's report". It is never a page inventory, never a list of every button, and never two independent tasks stitched into one sequence.

Each task carries:

- \`id\` — \`web/<kebab-slug>\`, named for the task ("web/silence-rule-from-violation-card").
- \`title\` — what the user accomplishes, in their words. One line.
- \`group\` — the family it sits in (the screen's area: "repos", "home", "settings").
- \`entry\` — \`{"method": "GET", "path": "<address>"}\`. The address is where the task is performed, exactly as the routing declares it, with \`{param}\` slots.
- \`steps\` — the ordered interactions, and ONLY the ones that make up this task:
  - \`{"kind": "navigate", "route": "/repos/{repoId}"}\` — moving to an address.
  - \`{"kind": "activate", "target": "button \\"Analyze\\""}\` — a click, a tap, a submit.
  - \`{"kind": "input", "target": "textbox \\"Repository path\\""}\` — putting a value in a field.
- \`at\` — the place the task is performed at (a resource id from \`list_places\`).
- \`to\` — the place it leaves the user at, ONLY when it moves them. A task that acts in place carries \`at\` alone.
- \`startingState\` / \`endState\` — ids from the state registry: the world the task assumes, and the world it leaves. Define any new id in \`states\`.
- \`apiEffects\` — the ids of the api interfaces the task's steps call (from \`list_interfaces\` with \`surface: "api"\`). \`[]\` means it reaches no server at all; omit the field when you could not establish what it calls. Never guess.

# The rules that are checked

1. **Locators are roles and accessible names, never selectors.** Every \`target\` is \`<role> "<accessible name>"\` — \`button "Add Repository"\`, \`textbox "Repository path"\`, \`switch "Enable rule"\`. The role is a real ARIA role. If an element has no role and no accessible name, it is NOT authorable: say so in \`unresolved\` rather than inventing a locator.
2. **A task is reachable.** Either it says where it happens (\`at\`), or its first step navigates to its entry address.
3. **The entry is the address the task starts at.** When the first step navigates, \`entry.path\` equals that route; when the task is \`at\` a place, \`entry.path\` is the address of the screen that place sits on.
4. **One task, one entry.** Two tasks with the same entry and the same steps are one task. Never author a task \`list_interfaces\` already shows.
5. **A state is a WORLD, not a place.** "a rule is silenced" is a state; "the rules dialog is open" is a place — that belongs in \`at\`/\`to\`. Every state id you reference must be defined once, in \`states\`, with one line saying what world it names.
6. **Nothing is guessed.** Every step target, every route, every api effect comes from something you READ in the source. What you cannot establish goes in \`unresolved\`, one line each.

# How to work

- \`list_places\` — the places and their addresses. \`list_interfaces\` — what is already catalogued (api ids for \`apiEffects\`, web ids so you never author a duplicate).
- \`search_repo\` and \`read_file\` — the application's source. Find the module that renders the place (search for its address in the routing), then read the components it renders: the accessible names are in the JSX (\`aria-label\`, button text, label elements), and the api calls are in the handlers.
- \`check_draft\` — run your draft through the exact rules the write path enforces, and fix what it reports. Do this before you finish.
- Then produce the outcome: the tasks, any new states, any place the catalog is missing, and \`unresolved\`.

# What good looks like

A screen with a list, a filter, and a detail action yields three or four tasks, each one thing a user came to do. A screen you could not locate in the source yields ZERO tasks and one line in \`unresolved\` naming what you looked for. Both are correct outcomes; a plausible-looking task nobody can run is not.`
