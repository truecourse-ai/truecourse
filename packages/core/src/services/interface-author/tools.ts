/**
 * THE SESSION'S TOOLS — every one of them READ-ONLY, and every one of them
 * bounded. An authoring session reads the app's own source (the JSX that
 * declares a screen's controls), reads the catalog it is extending, and checks
 * its own draft; it writes nothing. The write happens once, after the outcome,
 * in {@link ../write.ts} — a tool that wrote would put half a fragment on disk
 * every time a session ran out of budget mid-draft.
 *
 * THE PLACES ARE NOT A TOOL. They were — `list_places` — and a tool
 * result is the most expensive way to state a fact that never changes: every
 * session called it once, and the whole table then rode every subsequent turn
 * of that session's history, 245KB of re-sent tool results per run. The same
 * table in the BRIEFING sits in the cached prefix instead, and the session has
 * it before it asks. What a session needs of it is small and stated there: the
 * screens with their addresses (what `to` names), and the dialogs and panels on
 * its own place (what `of` names).
 *
 * `check_draft` is the one that makes the LOOP earn its keep rather than a
 * single prompt: the rules of {@link validateFragment} are dozens of small
 * structural facts (an id that resolves, a role that exists, an entry that
 * agrees with its place), and a model that can ASK is a model that converges on
 * them instead of being re-prompted about them. It is the same function the
 * write path runs, so a draft that checks clean cannot be refused afterwards.
 *
 * What it is asked for is an EARLY call, not only a closing one: the
 * fragment is dropped whole when it breaks a rule, so a session that first
 * checks at turn 24 pays for a misreading with the whole place, while the same
 * misreading on a first task at turn 5 costs a turn.
 */

import { z } from 'zod'
import { defineSessionTool, type SessionTool } from '@truecourse/agent-loop'
import type { InterfacesFile } from '@truecourse/shared'
import { readFileTool, searchTool } from '../agent/repo-tools.js'
import { AuthoredFragmentSchema, validateFragment } from './draft.js'

/** How many catalog entries one `list_interfaces` call hands back — a tool
 *  result is context, and context is the budget. */
const MAX_INTERFACES_LISTED = 200

export interface AuthorToolsInput {
  repoRoot: string
  /** The derived snapshot — the places, and the api ids `apiEffects` names. */
  derived: InterfacesFile | null
  /** The authored file as it stands on disk. */
  authored: InterfacesFile | null
  /** Ids this session may replace (its work item's own prior tasks). */
  replaceable: ReadonlySet<string>
  /** The place this session authors — `check_draft` holds the draft to it. */
  scope?: { screenId: string; address?: string }
}

export function buildAuthorTools(input: AuthorToolsInput): SessionTool[] {
  return [readFileTool(input.repoRoot), searchTool(input.repoRoot), interfacesTool(input), checkDraftTool(input)]
}

// ---------------------------------------------------------------------------
// the catalog the draft extends
// ---------------------------------------------------------------------------

function interfacesTool(input: AuthorToolsInput): SessionTool {
  return defineSessionTool({
    name: 'list_interfaces',
    description:
      'List the interfaces already in the catalog. Use `surface: "api"` to find the ids `apiEffects` names, and `surface: "web"` to see which tasks are already authored (never author one twice).',
    kind: 'list-interfaces',
    readOnly: true,
    destructive: false,
    inputSchema: z
      .object({
        surface: z.enum(['web', 'api', 'cli']).describe('Which surface to list.'),
        contains: z.string().min(1).optional().describe('Keep only entries whose id or title contains this text.'),
      })
      .strict(),
    async execute(args) {
      const all = [
        ...(input.derived?.interfaces ?? []).map((i) => ({ i, origin: 'derived' })),
        ...(input.authored?.interfaces ?? []).map((i) => ({ i, origin: 'authored' })),
      ].filter(({ i }) => i.type === args.surface)
      if (all.length === 0) return { content: `The catalog has no \`${args.surface}\` interface at all.` }
      const needle = args.contains?.toLowerCase()
      const filtered = needle
        ? all.filter(({ i }) => i.id.toLowerCase().includes(needle) || i.title.toLowerCase().includes(needle))
        : all
      // A filter that matches NOTHING answers the wrong question. The pilot's
      // worst turn-waster was six `contains` probes guessing names against a
      // surface that spells its operations differently — so a miss hands back the
      // surface itself when it fits, which settles the question in one call.
      const missed = needle !== undefined && filtered.length === 0
      const matched = missed && all.length <= MAX_INTERFACES_LISTED ? all : filtered
      if (matched.length === 0) {
        return {
          content: `No \`${args.surface}\` interface matches \`${args.contains}\`. The surface has ${all.length} entries — list them without \`contains\`, or search the source for what this screen actually calls.`,
        }
      }
      const shown = matched.slice(0, MAX_INTERFACES_LISTED)
      const rows = shown.map(({ i, origin }) => {
        const entry = 'command' in i.entry ? i.entry.command.join(' ') : `${i.entry.method} ${i.entry.path}`
        return `${i.id}  ·  ${entry}  ·  ${origin}  ·  ${i.title}`
      })
      const head = missed
        ? `Nothing matches \`${args.contains}\`. The whole \`${args.surface}\` surface is ${all.length} entries, so here it is:\n`
        : ''
      const tail = matched.length > shown.length ? `\n… ${matched.length - shown.length} more — narrow with \`contains\`.` : ''
      return { content: head + rows.join('\n') + tail }
    },
  })
}

function checkDraftTool(input: AuthorToolsInput): SessionTool {
  return defineSessionTool({
    name: 'check_draft',
    description:
      'Check a draft against every rule the write path enforces — id uniqueness, fingerprint uniqueness, the `<role> "<name>"` locator policy, reachability, and the catalog schema. Call it EARLY, on your first task or two, and again on the complete draft before you produce the outcome; a draft that checks clean is a draft that lands, and a misreading caught on the first task costs one turn instead of the place.',
    kind: 'check-draft',
    readOnly: true,
    destructive: false,
    inputSchema: AuthoredFragmentSchema,
    async execute(args) {
      const result = validateFragment({
        derived: input.derived,
        authored: input.authored,
        fragment: args,
        replaceable: input.replaceable,
        ...(input.scope ? { scope: input.scope } : {}),
      })
      if (result.ok) {
        return {
          content: `The draft is valid: ${args.interfaces.length} task(s), ${args.states?.length ?? 0} state(s), ${
            args.resources?.length ?? 0
          } place(s). Produce it as the outcome.`,
        }
      }
      return { content: `${result.errors.length} problem(s):\n- ${result.errors.join('\n- ')}`, isError: true }
    },
  })
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
