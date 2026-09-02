/**
 * SCREENS AND OPERATIONS — the render-time join behind the Interfaces tab.
 *
 * Every function here is pure and derives from what the catalog already carries.
 * There is NO schema change behind this file and nothing here is stored:
 *
 *   readables      → the facts a place SHOWS (the screen page's "the page shows"
 *                    table, {@link screenShowRows})
 *   `at`/`resource`→ which place a member belongs to
 *   `of`           → which SCREEN a panel or dialog is part of
 *   steps/grammar  → the ARGUMENT LISTS and the LOCATOR CHAIN minted below
 *   exits/statuses → the return types
 *   `to`           → the place a task hands you
 *   `apiEffects`   → what a task calls
 *
 * THE SHAPE OF A ROW IS THE SURFACE'S OWN. A catalog is not one tree — it is
 * three different kinds of thing, and one nested tree over all of them made the
 * common questions ("which screens are there", "what can I call") take a fold to
 * answer. So:
 *
 *   web (and any surface with places that is not api)
 *                  → SCREENS. One row per TOP-LEVEL place, carrying its panels
 *                    and dialogs as PARTS ({@link buildScreens}). A part is never
 *                    a row of its own: it has no address, and everything it holds
 *                    is read on the screen it is part of.
 *   api            → OPERATIONS. One row per INTERFACE ({@link buildOperations}) —
 *                    a method and a path, which is the thing a caller actually
 *                    calls. The REST NOUN is not a row: it is the ORDER the rows
 *                    come in (operations of one noun stay adjacent, in registry
 *                    order) and the "also on this endpoint" line on the page
 *                    ({@link endpointContext}). A noun no operation serves has no
 *                    row at all, and the panel counts it out ({@link buildEndpoints}).
 *   cli            → COMMANDS. One row per interface ({@link buildCommands}).
 *                    A command group is a prefix its members already spell, so
 *                    grouping by it would be the same words twice.
 *
 * SELECTION follows the row: a screen is addressed by its PLACE
 * (`web:repo-report`), an operation and a command by their own interface SLUG
 * (`api:patch-api-repos-id-rules-rulekey`, `cli:rules-disable`). One
 * `<surface>:<something>` address, one parse, one panel `activeId` for all three
 * ({@link placeSelectionId}, {@link interfaceSelectionId}).
 *
 * THE ONE INVENTED THING is the SIGNATURE — a name and an argument list minted
 * from fields the catalog does carry. It is display, never identity: no
 * fingerprint reads it, nothing matches on it, and a rename here re-authors
 * nothing. The rules are mechanical on purpose, so two readers mint the same
 * name for the same entry:
 *
 *   web  the task id, camelCased; args are the `{placeholder}` names in its step
 *        TARGETS in step order (a navigate ROUTE contributes none — nobody types
 *        a route into a page object), plus `text` for an input step that names no
 *        placeholder.
 *   cli  the command keeps its own name (the last argv segment); args are its
 *        positionals, then a compact option summary — elided to `…` when it is
 *        too long to read on one row, because the full grammar is one click away
 *        in the member's own contract.
 *   api  the method name comes from the HTTP method and the path's arity
 *        (a GET on a collection LISTS, a GET on an item READS); args are the path
 *        params the receiver does not already bind, then the request body as one
 *        object. The RECEIVER — the noun's last STATIC segment, so
 *        `PATCH /api/repos/{id}/rules/{ruleKey}` is `rules` and never `repoRules`
 *        — is only written when the call is made from somewhere ELSE
 *        ({@link apiCallName}); an operation's own page is headed by HTTP's own
 *        words, with no minted signature at all.
 *
 * The signature is what a member IS in the page-object reading — but it is not
 * how the UI names an action. The runner has no task verb (a scenario executes a
 * task as its individual verb steps), so the tab leads with the task's TITLE and
 * its locator chain, and an open member's identity line is its interface ID; the
 * signature still feeds the search haystack and stays available to any surface
 * that wants the page-object reading.
 *
 * ABSENCE STAYS VISIBLE, as everywhere else in guard: an `apiEffects` id that
 * resolves to nothing keeps its raw id rather than being dropped, and a member
 * whose place the registry does not carry falls into its surface's ENTRIES group
 * rather than pointing at a place that is not there.
 */

import type {
  GuardInterfaceRow,
  GuardWebLocator,
  InterfaceOption,
  InterfaceResource,
  InterfaceStep,
} from '@truecourse/shared';
import { describeWebLocator, webLocatorHandle } from '@truecourse/shared';

// ---------------------------------------------------------------------------
// Selection ids. A place id is AREA-SCOPED (web's `violations-list` and an api
// noun could collide), so the pane's subject is the pair, joined by a colon —
// the one character neither a driver id nor a resource id may contain.
// ---------------------------------------------------------------------------

/**
 * The pseudo-place every surface has: the members that name no place at all. It
 * is a place id nothing can collide with (a real one is never empty), so
 * `web:` addresses the web surface's loose ENTRIES exactly the way
 * `web:repo-report` addresses a real screen.
 */
export const ENTRIES_PLACE = '';

/** `web:repo-report` — the id the panel selects and the pane renders. */
export function placeSelectionId(surface: string, placeId: string): string {
  return `${surface}:${placeId}`;
}

/** The pair back out of a selection id; null for anything that is not one. */
export function parsePlaceSelectionId(id: string): { surface: string; placeId: string } | null {
  const at = id.indexOf(':');
  if (at < 0) return null;
  return { surface: id.slice(0, at), placeId: id.slice(at + 1) };
}

/** The place id a member belongs to: `at` for a web task, `resource` for the rest. */
export function memberPlaceId(iface: GuardInterfaceRow): string | undefined {
  return iface.at ?? iface.resource;
}

/**
 * WHAT A ROW IS on this surface. Keyed on the driver id rather than on what the
 * registry happens to hold, because the reading is the SURFACE'S: `api` is a set
 * of operations whether or not anybody nested its nouns, and a surface nobody has
 * a special reading for gets the screens one — places with parts, which is the
 * shape a place registry means by default.
 */
export type PomSurfaceShape = 'screens' | 'operations' | 'commands';

export function surfaceShape(surface: string): PomSurfaceShape {
  if (surface === 'cli') return 'commands';
  if (surface === 'api') return 'operations';
  return 'screens';
}

/**
 * Is the subject of this surface an INTERFACE rather than a place? Both the
 * operations and the commands shapes address one entry directly, and every reader
 * that resolves a selection asks this one question rather than listing shapes.
 */
export function selectsInterface(surface: string): boolean {
  return surfaceShape(surface) !== 'screens';
}

// ---------------------------------------------------------------------------
// Signatures.
// ---------------------------------------------------------------------------

/** `top-offenders` → `topOffenders`. Anything non-alphanumeric is a word break. */
export function camelCase(text: string): string {
  const words = text.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  return words
    .map((word, i) =>
      i === 0
        ? `${word.charAt(0).toLowerCase()}${word.slice(1)}`
        : `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
    )
    .join('');
}

/** The `{placeholder}` names in a string, in the order they appear. */
function placeholders(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(/\{([^{}]+)\}/g)) {
    const name = match[1];
    if (name) names.push(name);
  }
  return names;
}

/**
 * A web task's arguments: the placeholders its steps TARGET, in step order,
 * deduped. An input step that names none still takes something typed into it —
 * that is the `text` argument. A navigate route contributes nothing: the route
 * is where the method runs, not what a caller passes it.
 */
export function webArgs(steps: readonly InterfaceStep[]): string[] {
  const args: string[] = [];
  for (const step of steps) {
    if (step.kind !== 'activate' && step.kind !== 'input') continue;
    const names = placeholders(step.target);
    if (names.length > 0) args.push(...names);
    else if (step.kind === 'input') args.push('text');
  }
  return [...new Set(args)];
}

/** The task id without its surface prefix, camelCased — the method's own name. */
export function webName(id: string): string {
  const slash = id.indexOf('/');
  return camelCase(slash < 0 ? id : id.slice(slash + 1));
}

/**
 * WHAT the step acts on, in the vocabulary that step kind uses — a route for a
 * navigate, the element's own name for the two web kinds, the operation or the
 * argv for the two that never reach a web task. One definition, so a sequence
 * list, a locator chain and a search all say the same words about one step.
 */
export function stepTargetText(step: InterfaceStep): string {
  if (step.kind === 'navigate') return step.route;
  if (step.kind === 'input' || step.kind === 'activate') return step.target;
  if (step.kind === 'request') return `${step.method} ${step.path}`;
  return step.command.join(' ');
}

/**
 * THE LOCATOR CHAIN — the elements a task actually touches, in order:
 * `button "More actions" → menuitem "Disable rule for this repo"`. It sits under
 * the task's title in the Actions table, and it is the half of a task that says
 * where on the page it happens.
 *
 * Only the steps that NAME AN ELEMENT contribute. A `navigate` is where the task
 * runs rather than a thing on the page, and the cli/api kinds never reach a web
 * task at all — a chain of nothing is undefined, never an empty string, so the
 * caller renders no line rather than an empty one. Targets go in VERBATIM,
 * placeholders included: they are what the catalog stored and what the driver
 * will look for.
 */
export function taskLocatorChain(steps: readonly InterfaceStep[]): string | undefined {
  const targets = steps
    .filter((step) => step.kind === 'activate' || step.kind === 'input')
    .map(stepTargetText);
  return targets.length > 0 ? targets.join(' → ') : undefined;
}

/**
 * How long an option summary may get before the row stops reading as a
 * signature. Past it the summary elides to `…` — the positionals stay, because
 * they are what a caller MUST pass, and the full grammar is one click below.
 */
const OPTION_SUMMARY_MAX = 72;

/** `[--domain <name>]` / `[--enabled]` — one flag, as a caller would write it. */
function optionToken(option: InterfaceOption): string {
  if (!option.takesValue) return `[${option.flag}]`;
  return `[${option.flag} <${option.valueHint ?? 'value'}>]`;
}

/**
 * The flags a caller passes to THIS command. Program-scope flags (`--help`,
 * `--version`) belong to the program, not the command, so they are not part of
 * its signature — they would be identical on every row.
 */
function cliOptionSummary(options: readonly InterfaceOption[]): string {
  return options
    .filter((option) => option.scope !== 'program')
    .map(optionToken)
    .join(' ');
}

/** The argv path an entry is rooted at — empty for an entry that is not a command. */
function argvPath(iface: GuardInterfaceRow): string[] {
  const entry = iface.entry;
  return 'command' in entry ? entry.command : [];
}

/** The last argv segment — the name the command is registered under. */
function cliName(iface: GuardInterfaceRow): string {
  const path = argvPath(iface);
  return path[path.length - 1] ?? iface.id;
}

function cliArgs(iface: GuardInterfaceRow): string[] {
  const command = iface.contract?.surface === 'cli' ? iface.contract.command : undefined;
  const args = (command?.positionals ?? []).map((positional) => positional.name);
  // The grammar when the catalog derived one; otherwise the flags the step
  // itself carries, which is the floor every catalog has.
  const stepFlags = iface.steps.flatMap((step) => (step.kind === 'invoke' ? step.flags : []));
  const summary = command?.options
    ? cliOptionSummary(command.options)
    : stepFlags.map((flag) => `[${flag}]`).join(' ');
  if (summary) args.push(summary.length <= OPTION_SUMMARY_MAX ? summary : '…');
  return args;
}

/**
 * The WHOLE command path, as a reader types it — `truecourse rules disable`.
 *
 * A derived cli entry is TITLED by its argv path with the program name in front
 * (the argv itself carries only the subcommand chain), so the title is the fuller
 * of the two and wins whenever it ends in that chain. An authored entry titled in
 * prose does not, and falls back to the argv — the row's job is to be skimmable
 * as a command, not to repeat a sentence the pane says again below.
 */
export function commandLabel(iface: GuardInterfaceRow): string {
  const argv = argvPath(iface).join(' ');
  if (!argv) return iface.title;
  return iface.title === argv || iface.title.endsWith(` ${argv}`) ? iface.title : argv;
}

interface PathSegment {
  name: string;
  param: boolean;
}

/** The path split into segments, each marked as a `{param}` or a static noun. */
function pathSegments(path: string): PathSegment[] {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      const param = segment.startsWith('{') && segment.endsWith('}');
      return { name: param ? segment.slice(1, -1) : segment, param };
    });
}

/** Where the noun a caller reads this path as sits — its last STATIC segment. */
function receiverIndex(segments: readonly PathSegment[]): number {
  let index = -1;
  segments.forEach((segment, i) => {
    if (!segment.param) index = i;
  });
  return index;
}

/**
 * The operation's method name, minted from the HTTP verb and the path's ARITY:
 * a GET whose path ends in a `{param}` reads ONE item, a GET that does not lists
 * a collection. A verb outside the closed set keeps its own lowercased word
 * rather than being rounded to a neighbour.
 */
function apiMethodName(method: string, segments: readonly PathSegment[]): string {
  const verb = method.toUpperCase();
  if (verb === 'GET') return segments[segments.length - 1]?.param ? 'read' : 'list';
  if (verb === 'POST') return 'create';
  if (verb === 'PUT' || verb === 'PATCH') return 'update';
  if (verb === 'DELETE') return 'delete';
  return method.toLowerCase();
}

/**
 * `rules.update` for `PATCH /api/repos/{id}/rules/{ruleKey}` — the receiver is
 * the LAST STATIC segment, so every operation on one noun hangs off one
 * receiver whatever its ancestors are.
 */
export function apiCallName(method: string, path: string): string {
  const segments = pathSegments(path);
  const noun = segments[receiverIndex(segments)];
  // A path of nothing but params names no noun — `/{id}` is the root itself.
  const receiver = noun ? camelCase(noun.name) : 'root';
  return `${receiver}.${apiMethodName(method, segments)}`;
}

/**
 * An operation's arguments: the path params the RECEIVER does not already bind
 * (the ones after its own segment), then the request body as one object — so
 * `rules.update(ruleKey, {enabled})` says exactly what a caller has to hand it.
 */
function apiArgs(iface: GuardInterfaceRow, path: string): string[] {
  const segments = pathSegments(path);
  const args = segments
    .slice(receiverIndex(segments) + 1)
    .filter((segment) => segment.param)
    .map((segment) => segment.name);
  const body = iface.contract?.surface === 'api' ? iface.contract.operation.request?.body : undefined;
  if (body && body.length > 0) args.push(`{${body.map((field) => field.name).join(', ')}}`);
  return args;
}

/** The member's signature as a reader calls it — `silenceRuleFromViolationCard()`. */
export function memberSignature(iface: GuardInterfaceRow): string {
  const entry = iface.entry;
  if (iface.type === 'cli' || 'command' in entry) {
    return `${cliName(iface)}(${cliArgs(iface).join(', ')})`;
  }
  if (iface.type === 'api') {
    // No receiver here: the RECEIVER is the endpoint this operation is on, and a
    // page object does not repeat it on every method. A CALL from elsewhere does
    // — that is what `apiCallName` is for.
    const method = apiMethodName(entry.method, pathSegments(entry.path));
    return `${method}(${apiArgs(iface, entry.path).join(', ')})`;
  }
  return `${webName(iface.id)}(${webArgs(iface.steps).join(', ')})`;
}

/**
 * The member's RETURN TYPE — the distinct exit codes of a command, the distinct
 * statuses of an operation, in first-seen order. `unknown` stays the word
 * `unknown`: an unsettled status is information, and rounding it to a plausible
 * number is how a scenario ends up asserting a promise nobody made.
 */
export function memberReturns(iface: GuardInterfaceRow): string | undefined {
  const contract = iface.contract;
  const values =
    contract?.surface === 'cli'
      ? contract.command.io?.produces?.exits?.map((fact) => fact.exit)
      : contract?.surface === 'api'
        ? contract.operation.produces?.statuses?.map((fact) => fact.status)
        : undefined;
  if (!values || values.length === 0) return undefined;
  return [...new Set(values)].join(' | ');
}

/**
 * The world the member moves through, as the pair of state ids: `a → b`, or one
 * side alone when only one was established. Ids, never prose — two members chain
 * when these match exactly.
 */
export function stateTransition(iface: GuardInterfaceRow): string | undefined {
  const { startingState: start, endState: end } = iface;
  if (start && end) return `${start} → ${end}`;
  if (end) return `→ ${end}`;
  if (start) return `${start} →`;
  return undefined;
}

// ---------------------------------------------------------------------------
// HTTP methods, as the operation rows wear them.
// ---------------------------------------------------------------------------

/**
 * The order a reader scans methods in — the two reads first, then the writes from
 * least to most destructive. A verb outside the set keeps its place at the END,
 * in the order the catalog listed it: an unknown method is a catalog fact, not a
 * thing to round to a neighbour.
 */
const METHOD_ORDER = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** The HTTP method an entry names — empty for an entry that is a command. */
export function entryMethod(iface: GuardInterfaceRow): string {
  const entry = iface.entry;
  return 'command' in entry ? '' : entry.method.toUpperCase();
}

/** The path an entry names — empty for an entry that is a command. */
export function entryPath(iface: GuardInterfaceRow): string {
  const entry = iface.entry;
  return 'command' in entry ? '' : entry.path;
}

/**
 * The operations of ONE endpoint, in reading order: by method
 * ({@link METHOD_ORDER}), then by path — so two operations that differ only in
 * arity (`/rules` and `/rules/{ruleKey}`) always come out the same way round.
 */
function sortOperations(members: readonly GuardInterfaceRow[]): GuardInterfaceRow[] {
  const rank = (method: string): number => {
    const at = METHOD_ORDER.indexOf(method);
    return at < 0 ? METHOD_ORDER.length : at;
  };
  return [...members].sort((a, b) => {
    const byMethod = rank(entryMethod(a)) - rank(entryMethod(b));
    if (byMethod !== 0) return byMethod;
    const byVerb = entryMethod(a).localeCompare(entryMethod(b));
    if (byVerb !== 0) return byVerb;
    return entryPath(a).localeCompare(entryPath(b));
  });
}

// ---------------------------------------------------------------------------
// The rows, per surface shape.
// ---------------------------------------------------------------------------

/** One PART of a screen — the screen itself, or a panel/dialog `of` it. */
export interface PomPart {
  place: InterfaceResource;
  /** The interfaces whose `at`/`resource` names THIS part, in catalog order. */
  members: GuardInterfaceRow[];
}

/** One SCREEN row: a top-level place, everything that is part of it, and the tally. */
export interface PomScreen {
  /** `${surface}:${place.id}` — the selection id. */
  id: string;
  surface: string;
  place: InterfaceResource;
  /** The screen itself first, then its parts in registry order. */
  parts: PomPart[];
  /** Members across every part — what the row's tally says. */
  count: number;
}

/** One ENDPOINT: a REST noun and the operations attributed to IT. Not a row. */
export interface PomEndpoint {
  surface: string;
  place: InterfaceResource;
  /** The noun's own operations, in row order. */
  members: GuardInterfaceRow[];
}

/** One OPERATION row: one api interface, addressed by its own slug. */
export interface PomOperation {
  id: string;
  surface: string;
  iface: GuardInterfaceRow;
  /** Uppercased — the label the row leads with. */
  method: string;
  path: string;
  /** The endpoint it is on; absent when the registry carries no noun for it. */
  place?: InterfaceResource;
}

/** One COMMAND row: a cli interface, addressed by its own id. */
export interface PomCommand {
  id: string;
  surface: string;
  iface: GuardInterfaceRow;
  /** The whole command path — `truecourse rules disable`. */
  label: string;
}

/** The interfaces of one surface, keyed by the place id each names. */
function membersByPlace(
  surface: string,
  interfaces: readonly GuardInterfaceRow[],
): Map<string, GuardInterfaceRow[]> {
  const byPlace = new Map<string, GuardInterfaceRow[]>();
  for (const iface of interfaces) {
    if (iface.type !== surface) continue;
    const placeId = memberPlaceId(iface);
    if (placeId === undefined) continue;
    byPlace.set(placeId, [...(byPlace.get(placeId) ?? []), iface]);
  }
  return byPlace;
}

/**
 * The TOP-LEVEL place a place is part of — itself when it sits on nothing.
 * Undefined for an id this registry does not carry, which is the one honest
 * answer: a member pointing at it is loose, not on some other screen.
 *
 * A place whose `of` names something the registry does not carry is a TOP-LEVEL
 * place rather than a dropped one — the nesting is a reading aid, and losing a
 * place to a dangling parent would lose its members with it. A registry that
 * names a CYCLE roots every place in it on itself, for the same reason: a ring
 * has no top, and the alternative is a set of places no row anywhere shows.
 */
export function topPlaceId(
  placeId: string,
  resources: readonly InterfaceResource[] | undefined,
): string | undefined {
  const byId = new Map((resources ?? []).map((r) => [r.id, r]));
  const start = byId.get(placeId);
  if (!start) return undefined;
  let current = start;
  const walked = new Set<string>([current.id]);
  while (current.of !== undefined) {
    const parent = byId.get(current.of);
    if (!parent) break;
    if (walked.has(parent.id)) return start.id;
    walked.add(parent.id);
    current = parent;
  }
  return current.id;
}

/**
 * One surface's SCREENS — a row per top-level place, carrying every place that is
 * part of it. Parts come in REGISTRY order (the screen itself first), which is
 * the order the catalog first names them in, so the page's tables read in one
 * order however deep the `of` chain runs.
 */
export function buildScreens(
  surface: string,
  resources: readonly InterfaceResource[],
  interfaces: readonly GuardInterfaceRow[],
): PomScreen[] {
  const roots = new Map<string, string>();
  for (const resource of resources) {
    const top = topPlaceId(resource.id, resources);
    if (top !== undefined) roots.set(resource.id, top);
  }
  const members = membersByPlace(surface, interfaces);
  const part = (place: InterfaceResource): PomPart => ({
    place,
    members: members.get(place.id) ?? [],
  });

  return resources
    .filter((resource) => roots.get(resource.id) === resource.id)
    .map((place) => {
      const parts = [
        part(place),
        ...resources.filter((r) => r.id !== place.id && roots.get(r.id) === place.id).map(part),
      ];
      return {
        id: placeSelectionId(surface, place.id),
        surface,
        place,
        parts,
        count: parts.reduce((n, p) => n + p.members.length, 0),
      };
    });
}

/**
 * One surface's ENDPOINTS — a REST noun and the operations attributed to IT.
 * Nouns are NOT folded into their `of` parents: two paths that nest in the
 * registry are still two things a caller calls.
 *
 * This is no longer a row (the OPERATION is — see {@link buildOperations}); it is
 * what the panel counts an empty noun out of and what the page's "also on this
 * endpoint" line is built from.
 */
export function buildEndpoints(
  surface: string,
  resources: readonly InterfaceResource[],
  interfaces: readonly GuardInterfaceRow[],
): PomEndpoint[] {
  const members = membersByPlace(surface, interfaces);
  return resources.map((place) => ({
    surface,
    place,
    members: sortOperations(members.get(place.id) ?? []),
  }));
}

/**
 * One surface's OPERATIONS — a row per interface, which is what a caller calls.
 *
 * The ORDER is the endpoint's: the registry's nouns in their own order, each
 * noun's operations sorted GET, HEAD, POST, PUT, PATCH, DELETE and then by path,
 * so the rows of one endpoint stay adjacent and read the same way every time.
 * An operation whose noun the registry does not carry keeps its catalog order at
 * the END — it is still a thing you can call, and dropping it would hide code.
 */
export function buildOperations(
  surface: string,
  resources: readonly InterfaceResource[],
  interfaces: readonly GuardInterfaceRow[],
): PomOperation[] {
  const members = membersByPlace(surface, interfaces);
  const known = new Set(resources.map((r) => r.id));
  const row = (iface: GuardInterfaceRow, place?: InterfaceResource): PomOperation => ({
    id: interfaceSelectionId(iface),
    surface,
    iface,
    method: entryMethod(iface),
    path: entryPath(iface),
    ...(place ? { place } : {}),
  });

  const grouped = resources.flatMap((place) =>
    sortOperations(members.get(place.id) ?? []).map((iface) => row(iface, place)),
  );
  const loose = interfaces
    .filter((iface) => {
      if (iface.type !== surface) return false;
      const placeId = memberPlaceId(iface);
      return placeId === undefined || !known.has(placeId);
    })
    .map((iface) => row(iface));
  return [...grouped, ...loose];
}

/** An interface id without its surface prefix — `cli/rules-disable` → `rules-disable`. */
export function interfaceSlug(iface: GuardInterfaceRow): string {
  const prefix = `${iface.type}/`;
  return iface.id.startsWith(prefix) ? iface.id.slice(prefix.length) : iface.id;
}

/**
 * An interface's own selection id. The subject IS the entry — an operation, a
 * command — so the id carries its slug rather than a place id:
 * `cli:rules-disable`, `api:patch-api-repos-id-rules-rulekey`. It is still the
 * same `<surface>:<something>` address a screen uses, so one tab param, one parse
 * and one panel `activeId` cover every shape.
 */
export function interfaceSelectionId(iface: GuardInterfaceRow): string {
  return placeSelectionId(iface.type, interfaceSlug(iface));
}

/** The interface a slug-addressed selection names, back out of the catalog. */
export function findInterfaceBySlug(
  surface: string,
  slug: string,
  interfaces: readonly GuardInterfaceRow[],
): GuardInterfaceRow | undefined {
  return interfaces.find((iface) => iface.type === surface && interfaceSlug(iface) === slug);
}

/** One surface's COMMANDS — every interface it has, flat, in catalog order. */
export function buildCommands(surface: string, interfaces: readonly GuardInterfaceRow[]): PomCommand[] {
  return interfaces
    .filter((iface) => iface.type === surface)
    .map((iface) => ({
      id: interfaceSelectionId(iface),
      surface,
      iface,
      label: commandLabel(iface),
    }));
}

/**
 * WHERE an interface id opens — the join every cross-navigation runs. A web task
 * resolves to the SCREEN its place is part of (a panel is not a destination); an
 * operation and a command resolve to THEMSELVES, because each is its own row. A
 * web member whose place the registry does not carry resolves to its surface's
 * ENTRIES group, which is where the panel puts it too: one rule, so a jump can
 * never land on a row the list is not showing.
 */
export function placeSelectionForInterface(
  iface: GuardInterfaceRow,
  resources: readonly InterfaceResource[] | undefined,
): string {
  if (selectsInterface(iface.type)) return interfaceSelectionId(iface);
  const placeId = memberPlaceId(iface);
  if (placeId === undefined) return placeSelectionId(iface.type, ENTRIES_PLACE);
  return placeSelectionId(iface.type, topPlaceId(placeId, resources) ?? ENTRIES_PLACE);
}

/**
 * The ENDPOINT an operation is on and the OTHER operations on it — the "also on
 * this endpoint" line. Siblings come in the same order the panel lists them, so
 * a chip and a row can never disagree about which operation is which.
 *
 * An operation the registry names no noun for has no endpoint and no siblings:
 * two paths are not one endpoint just because nobody grouped them.
 */
export function endpointContext(
  iface: GuardInterfaceRow,
  resources: readonly InterfaceResource[] | undefined,
  interfaces: readonly GuardInterfaceRow[],
): { place?: InterfaceResource; siblings: GuardInterfaceRow[] } {
  const placeId = memberPlaceId(iface);
  const place = placeId === undefined ? undefined : (resources ?? []).find((r) => r.id === placeId);
  if (!place) return { siblings: [] };
  const siblings = sortOperations(
    interfaces.filter(
      (other) =>
        other.type === iface.type && memberPlaceId(other) === place.id && other.id !== iface.id,
    ),
  );
  return { place, siblings };
}

/**
 * The members of one surface that sit at no place the registry carries — every
 * `web` entry point, in practice: a task that OPENS a screen acts before there
 * is a place to act at. They are still members, so they read as signatures under
 * their surface rather than disappearing.
 *
 * Not used on a surface whose rows are interfaces: there every entry is already
 * a row of its own.
 */
export function looseEntries(
  surface: string,
  resources: readonly InterfaceResource[] | undefined,
  interfaces: readonly GuardInterfaceRow[],
): GuardInterfaceRow[] {
  const known = new Set((resources ?? []).map((r) => r.id));
  return interfaces.filter((iface) => {
    if (iface.type !== surface) return false;
    const placeId = memberPlaceId(iface);
    return placeId === undefined || !known.has(placeId);
  });
}

// ---------------------------------------------------------------------------
// The screen's two tables.
// ---------------------------------------------------------------------------

/** One row of the ACTIONS table: a task, and the part of the screen it acts on. */
export interface PomAction {
  iface: GuardInterfaceRow;
  part: InterfaceResource;
}

/**
 * Every task on the screen and its descendants, in part order then catalog order
 * — one row each, whatever part it is on. The screen is ONE contract; which panel
 * a task happens to sit on is a column, not a heading.
 */
export function screenActions(screen: PomScreen): PomAction[] {
  return screen.parts.flatMap(({ place, members }) =>
    members.map((iface) => ({ iface, part: place })),
  );
}

/**
 * WHICH PART of the screen a row is on, in the words a column has room for. The
 * registry titles places as prose ("the violation list") because a sentence names
 * them; a column does not, so the leading article goes. The screen ITSELF reads
 * as "the screen" rather than repeating the heading two lines above it.
 */
export function actionWhere(screen: PomScreen, part: InterfaceResource): string {
  if (part.id === screen.place.id && part.kind === 'screen') return 'the screen';
  return part.title.replace(/^the /, '');
}

/** What kind of fact a "the page shows" row is — the four readable kinds. */
export type PomShowKind = 'shows' | 'lists' | 'renders' | 'click';

/** One row of the SHOWS table: a readable, flattened into five columns. */
export interface PomShowRow {
  kind: PomShowKind;
  /** The fact itself — the marker, the row template, the element, the states. */
  what: string;
  /**
   * The addressable element, in {@link describeWebLocator}'s vocabulary. Absent
   * where the catalog records none — a marker with no `within` is read off the
   * whole place, and the column says so with an em dash rather than a guess.
   */
  locator?: string;
  when?: string;
  part: InterfaceResource;
}

/** `“Violations”` — a locator's own NAME, for the column that carries the thing. */
function locatorName(locator: GuardWebLocator): string {
  return `“${webLocatorHandle(locator).value}”`;
}

/**
 * Everything the screen SHOWS, across its parts, as table rows: markers, row
 * grammars, elements and controls, in that order per part, in declaration order
 * within each kind.
 *
 * The absence rule holds: a part with no readables contributes nothing, and a
 * kind the derivation never established contributes nothing — no row is invented
 * to say a place shows none of something nobody looked for.
 */
export function screenShowRows(screen: PomScreen): PomShowRow[] {
  return screen.parts.flatMap(({ place }) => {
    const r = place.readables;
    const rows: PomShowRow[] = [];
    for (const fact of r?.markers ?? []) {
      rows.push({
        kind: 'shows',
        what: `“${fact.marker}”`,
        ...(fact.within ? { locator: `in ${describeWebLocator(fact.within)}` } : {}),
        ...(fact.when ? { when: fact.when } : {}),
        part: place,
      });
    }
    for (const fact of r?.rows ?? []) {
      rows.push({
        kind: 'lists',
        what: fact.template,
        // The ITEM's role is the addressable thing — one entry is printed once
        // per item, so a name would be a different string on every one of them.
        locator: fact.within
          ? `${fact.item} · in ${describeWebLocator(fact.within)}`
          : fact.item,
        ...(fact.when ? { when: fact.when } : {}),
        part: place,
      });
    }
    for (const fact of r?.elements ?? []) {
      rows.push({
        kind: 'renders',
        what: locatorName(fact.element),
        locator: describeWebLocator(fact.element),
        ...(fact.when ? { when: fact.when } : {}),
        part: place,
      });
    }
    for (const fact of r?.controls ?? []) {
      rows.push({
        kind: 'click',
        // `states` declares EXPOSURE, never a value — which position the switch
        // is in belongs to a scenario's assertion, not to the catalog.
        what: `exposes ${fact.states.join(', ')}`,
        locator: describeWebLocator(fact.control),
        ...(fact.when ? { when: fact.when } : {}),
        part: place,
      });
    }
    return rows;
  });
}

// ---------------------------------------------------------------------------
// Search. A row matches on its own words AND on everything it holds — looking
// for a task must find the screen it is called on, which is where it reads.
// ---------------------------------------------------------------------------

function memberWords(iface: GuardInterfaceRow): string[] {
  const entry = iface.entry;
  return [
    iface.id,
    iface.title,
    memberSignature(iface),
    'command' in entry ? entry.command.join(' ') : `${entry.method} ${entry.path}`,
    // The elements a task touches: a reader looking for the screen with the
    // "More actions" menu on it is searching for a locator, not for a title.
    ...iface.steps.map(stepTargetText),
  ];
}

function placeWords(place: InterfaceResource): string[] {
  return [place.id, place.title, place.description ?? '', place.address ?? ''];
}

export function screenHaystack(screen: PomScreen): string {
  return screen.parts
    .flatMap(({ place, members }) => [...placeWords(place), ...members.flatMap(memberWords)])
    .join(' ')
    .toLowerCase();
}

/** An operation matches on its own words AND on the endpoint it is served by. */
export function operationHaystack(operation: PomOperation): string {
  return [
    `${operation.method} ${operation.path}`,
    ...(operation.place ? placeWords(operation.place) : []),
    ...memberWords(operation.iface),
  ]
    .join(' ')
    .toLowerCase();
}

export function commandHaystack(command: PomCommand): string {
  return [command.label, ...memberWords(command.iface)].join(' ').toLowerCase();
}

export function memberHaystack(iface: GuardInterfaceRow): string {
  return memberWords(iface).join(' ').toLowerCase();
}

// ---------------------------------------------------------------------------
// The calls block.
// ---------------------------------------------------------------------------

/** One `apiEffects` id, joined to the api entry it names — or left as the id. */
export interface PomCall {
  id: string;
  /** `rules.update`, minted from the joined entry. Absent when nothing resolved. */
  name?: string;
  /** `PATCH /api/repos/{id}/rules/{ruleKey}` — the joined entry's own words. */
  operation?: string;
}

/**
 * The `apiEffects` ids as calls. An id that resolves to nothing renders AS the
 * id: the relation is what the catalog established, and quietly dropping half of
 * it would read as a screen that calls fewer endpoints than it does.
 */
export function resolveApiEffects(
  ids: readonly string[],
  interfaces: readonly GuardInterfaceRow[],
): PomCall[] {
  const byId = new Map(interfaces.map((iface) => [iface.id, iface]));
  return ids.map((id) => {
    const target = byId.get(id);
    const entry = target?.entry;
    if (!entry || 'command' in entry) return { id };
    return {
      id,
      name: apiCallName(entry.method, entry.path),
      operation: `${entry.method.toUpperCase()} ${entry.path}`,
    };
  });
}
