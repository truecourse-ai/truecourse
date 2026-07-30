/**
 * EXTERNAL HTTP REFERENCES — the third parties a repo talks to with a bare request
 * and no SDK at all (item 63).
 *
 * The SDK detector (`external-services.ts`) can only see what the import graph
 * names, so an app whose entire integration is `fetch(new URL('/v1/search', base))`
 * against `https://api.open-meteo.com` detects as having no third party whatsoever.
 * What such an app DOES leave in the source is the URL itself — usually as the
 * fallback of a configuration read, which is also where the env var that overrides
 * it is written down. This pass harvests both.
 *
 * Why a tree-sitter pass and not a scan of `FileAnalysis.calls`: `calls` carries
 * only call sites, and the interesting URL is typically NOT at one — it sits in a
 * module-level `const DEFAULTS = { FORECAST_BASE_URL: 'https://…' }` or a
 * `process.env.X ?? 'https://…'` initializer. Structure is also the only honest way
 * to say WHICH env var a URL belongs to when a file declares several.
 *
 * JS/TS ONLY in this slice. Python and C# parse into the same shape and are a
 * recorded follow-up (item 63); until then they contribute nothing, which reads as
 * "not looked at", never "has no third parties".
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'
import type { DatastoreUrlRef, ExternalHttpRef, SupportedLanguage } from '@truecourse/shared'

/** What one file yields: the bound URL literals, plus the name-only env candidates. */
export interface ExternalHttpExtraction {
  refs: ExternalHttpRef[]
  urlEnvReads: string[]
  /**
   * Datastore connection URLs (item 68) — the SAME walk and the SAME env-association
   * rules, over a different scheme set. They are not third parties (nothing is
   * "requested" from them and their host is the machine itself), so they never mix
   * into `refs`; the recipe proposer is their only consumer.
   */
  datastoreRefs: DatastoreUrlRef[]
}

const EMPTY: ExternalHttpExtraction = { refs: [], urlEnvReads: [], datastoreRefs: [] }

/**
 * Hosts that are never a third-party SERVICE, even though they are written as
 * absolute http(s) URLs:
 * - the machine itself and the reserved test/documentation names (RFC 2606/6761),
 *   which is what a local dev default or a fixture URL looks like;
 * - namespace / specification identifiers — `http://www.w3.org/2000/svg` is an XML
 *   namespace, not an endpoint, and `https://json-schema.org/draft/…` is a `$schema`
 *   value. Nothing is ever REQUESTED from these, so calling them a dependency would
 *   be a fabrication.
 * Matched on the exact host or as a domain suffix (`*.local`, `*.example.com`).
 */
export const NON_SERVICE_HOSTS: readonly string[] = [
  'localhost',
  '0.0.0.0',
  '[::1]',
  'example.com',
  'example.org',
  'example.net',
  'example.edu',
  'w3.org',
  'www.w3.org',
  'json-schema.org',
  'schema.org',
  'spec.openapis.org',
  'swagger.io',
  'tools.ietf.org',
  'www.rfc-editor.org',
  'opensource.org',
  'creativecommons.org',
  'developer.mozilla.org',
]

/** Reserved / private-use suffixes: a host under one of these is never public. */
const NON_SERVICE_SUFFIXES: readonly string[] = [
  '.local',
  '.localhost',
  '.test',
  '.example',
  '.invalid',
  '.internal',
  '.localdomain',
]

/**
 * The URL schemes that name a DATASTORE the app connects to (item 68). Harvested
 * for the recipe proposer, which derives a container from the app's own connection
 * URL; the scheme→engine decision is the proposer's, so this list only has to be a
 * superset of what it can map.
 */
export const DATASTORE_URL_SCHEMES: readonly string[] = [
  'postgres',
  'postgresql',
  'mysql',
  'mariadb',
  'mongodb+srv',
  'mongodb',
  'redis',
  'rediss',
]

/** `postgres://…` at the head of a literal — longest alternatives first. */
const DATASTORE_URL = new RegExp(`^(?:${DATASTORE_URL_SCHEMES.map((s) => s.replace('+', '\\+')).join('|')})://`, 'i')

/** The same, as it appears QUOTED inside a chunk of source text (the one-URL rule). */
const DATASTORE_URL_IN_TEXT = new RegExp(
  `['"\`](?:${DATASTORE_URL_SCHEMES.map((s) => s.replace('+', '\\+')).join('|')})://`,
  'gi',
)

/** Env identifiers that read like a base-URL override — `STRIPE_API_BASE`, `FOO_HOST`. */
const BASE_URL_HINT = /(?:^|_)(URL|URI|BASE|BASEURL|HOST|HOSTNAME|ENDPOINT|ORIGIN)(?:_|$)/

/**
 * An env read, in the two shapes JS writes them: `process.env.FOO` / `env.FOO` and
 * `process.env['FOO']` / `env['FOO']`. Deliberately text-based (run over a SUBTREE's
 * text, never the whole file) — the structural question "is this read in the same
 * initializer as that URL?" is answered by WHICH subtree we run it on.
 */
const ENV_READ = /(?:process\s*\.\s*env|(?<![\w.$])env)\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*['"]([^'"]+)['"]\s*\])/g

/** Any sign the file reads configuration from the environment at all. */
const ANY_ENV_ACCESS = /process\s*\.\s*env|(?<![\w.$])env\s*[[.]|os\s*\.\s*environ/

/** A SCREAMING_SNAKE identifier — how an env variable is named by convention. */
const ENV_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/

/**
 * Env vars that select a MODE rather than configure an endpoint. They appear in the
 * same expression as a URL constantly (`env.NODE_ENV === 'prod' ? 'https://a' : …`)
 * and binding one would advertise "override NODE_ENV to point the app elsewhere",
 * which is false.
 */
const MODE_ENV_NAMES = new Set(['NODE_ENV', 'APP_ENV', 'ENVIRONMENT', 'DEPLOY_ENV', 'LOG_LEVEL'])

/** How far up from a URL literal we look for the env var bound to it. */
const MAX_CLIMB = 4

/**
 * Nodes we never climb THROUGH: past one of these the "same initializer" claim stops
 * being true, and an env read found beyond it belongs to different code.
 */
const CLIMB_STOP = new Set([
  'program',
  'statement_block',
  'class_body',
  'function_declaration',
  'method_definition',
  'export_statement',
])

/**
 * The external HTTP references in one parsed file. Pure: no I/O, no tree-sitter
 * node escapes the return.
 */
export function extractExternalHttp(
  tree: Tree,
  filePath: string,
  language: SupportedLanguage,
): ExternalHttpExtraction {
  if (language !== 'typescript' && language !== 'tsx' && language !== 'javascript') return EMPTY

  const root = tree.rootNode
  const fileText = root.text
  const fileReadsEnv = ANY_ENV_ACCESS.test(fileText)

  const refs: ExternalHttpRef[] = []
  const datastoreRefs: DatastoreUrlRef[] = []
  const cursor = tree.walk()

  function visit(): void {
    const type = cursor.nodeType
    if (type === 'string' || type === 'template_string') {
      const node = cursor.currentNode
      const location = () => ({
        filePath,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startColumn: node.startPosition.column,
        endColumn: node.endPosition.column,
      })
      const literal = urlLiteral(node)
      const host = literal ? serviceHost(literal) : null
      if (literal && host) {
        const envVar = boundEnvVar(node, fileReadsEnv, countUrlLiterals)
        refs.push({
          url: literal,
          host,
          ...(envVar ? { envVar } : {}),
          location: location(),
        })
      }
      const datastore = datastoreLiteral(node)
      if (datastore) {
        const envVar = boundEnvVar(node, fileReadsEnv, countDatastoreLiterals)
        datastoreRefs.push({
          url: datastore,
          scheme: datastore.slice(0, datastore.indexOf(':')).toLowerCase(),
          ...(envVar ? { envVar } : {}),
          location: location(),
        })
      }
      // A string has no children worth walking.
      return
    }
    if (cursor.gotoFirstChild()) {
      do {
        visit()
      } while (cursor.gotoNextSibling())
      cursor.gotoParent()
    }
  }

  visit()

  return { refs, urlEnvReads: urlishEnvReads(fileText), datastoreRefs }
}

/**
 * The datastore connection URL a string node carries, or null. Same truncation rule
 * as {@link urlLiteral}: a template contributes its HEAD, so
 * `` `postgres://localhost:5432/${name}` `` yields everything up to the database
 * name — a host and port are still the truth about where the datastore lives.
 */
function datastoreLiteral(node: SyntaxNode): string | null {
  const inner = literalText(node)
  return DATASTORE_URL.test(inner) ? inner : null
}

/**
 * The http(s) URL a string node carries, or null. A template literal contributes its
 * HEAD (`` `https://api.x.com/v1/${id}` `` → `https://api.x.com/v1/`) — enough to
 * name the host, which is all a service identity needs; one that interpolates the
 * origin itself (`` `${base}/v1` ``) contributes nothing, correctly.
 */
function urlLiteral(node: SyntaxNode): string | null {
  const inner = literalText(node)
  if (!/^https?:\/\//i.test(inner)) return null
  return inner
}

/**
 * A string node's contribution as text: a plain string minus its quotes, a template
 * minus its backticks and truncated at the first interpolation. The CLOSING backtick
 * strip matters for a template with no `${…}` at all — `` `https://console.cal.com` ``
 * must not yield a host ending in a backtick, which would dodge both the `ownHosts`
 * match and clean domain grouping.
 */
function literalText(node: SyntaxNode): string {
  const raw = node.text
  return node.type === 'template_string'
    ? raw.replace(/^`/, '').split('${')[0]!.replace(/`$/, '')
    : raw.replace(/^['"]/, '').replace(/['"]$/, '')
}

/**
 * The hostname of `url` when it is plausibly a third party's, else null: junk that
 * does not parse, an IP address (an address is not an identity), a single-label host
 * (a container/service name on a private network), and everything on the exclusion
 * lists above.
 */
export function serviceHost(url: string): string | null {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  if (!host) return null
  if (NON_SERVICE_HOSTS.includes(host)) return null
  if (NON_SERVICE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null
  if (NON_SERVICE_HOSTS.some((h) => h.includes('.') && host.endsWith(`.${h}`))) return null
  // Bare IPv4/IPv6 (`127.0.0.1`, `10.0.0.5`, `[::1]`) and single-label hosts.
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) return null
  if (!host.includes('.')) return null
  return host
}

/**
 * The env var this URL literal is the FALLBACK for, when the source says so:
 *
 *   1. an env read inside the smallest enclosing expression that contains this URL
 *      and no OTHER URL — `process.env.FOO ?? 'https://host'`, `env['FOO'] || '…'`,
 *      `const b = process.env.FOO ?? '…'`. The one-URL rule is what keeps a
 *      multi-property object from binding every URL in it to one stray env read;
 *   2. failing that, an ENV-SHAPED object key whose value IS this URL — the defaults
 *      map (`const DEFAULTS = { FORECAST_BASE_URL: 'https://…' }`) that a
 *      `readUrl(env, 'FORECAST_BASE_URL', DEFAULTS.FORECAST_BASE_URL)` reads through
 *      a variable, so no static `process.env.FORECAST_BASE_URL` exists to find.
 *      Requires the file to read the environment at all, so a constants table in a
 *      file that never touches `env` is not misread as configuration.
 *
 * `countLiterals` is the family the one-URL rule counts — http literals for an http
 * ref, datastore literals for a datastore one. Counting only the OWN family is what
 * lets `const DEFAULTS = {API_URL: 'https://…', DATABASE_URL: 'postgres://…'}` bind
 * both keys: the two URLs are never each other's competition.
 */
function boundEnvVar(
  node: SyntaxNode,
  fileReadsEnv: boolean,
  countLiterals: (text: string) => number,
): string | undefined {
  let current: SyntaxNode | null = node.parent
  for (let depth = 0; current && depth < MAX_CLIMB; depth++, current = current.parent) {
    if (CLIMB_STOP.has(current.type)) break
    const text = current.text
    if (countLiterals(text) === 1) {
      const name = firstEnvRead(text)
      if (name) return name
    }
  }
  const parent = node.parent
  if (fileReadsEnv && parent && parent.type === 'pair') {
    const key = parent.childForFieldName('key')
    const value = parent.childForFieldName('value')
    if (key && value && value.id === node.id) {
      const name = key.text.replace(/^['"]|['"]$/g, '')
      if (ENV_NAME.test(name)) return name
    }
  }
  return undefined
}

/** How many http(s) literals a chunk of source text contains. */
function countUrlLiterals(text: string): number {
  return (text.match(/['"`]https?:\/\//gi) ?? []).length
}

/** How many datastore connection-URL literals a chunk of source text contains. */
function countDatastoreLiterals(text: string): number {
  DATASTORE_URL_IN_TEXT.lastIndex = 0
  return (text.match(DATASTORE_URL_IN_TEXT) ?? []).length
}

/** The first CONFIGURATION env-var name read in a chunk of source text. */
function firstEnvRead(text: string): string | undefined {
  ENV_READ.lastIndex = 0
  for (const match of text.matchAll(ENV_READ)) {
    const name = match[1] ?? match[2]
    if (name && ENV_NAME.test(name) && !MODE_ENV_NAMES.has(name)) return name
  }
  return undefined
}

/**
 * The URL-ISH env vars a file reads without binding a literal to them — the
 * lower-confidence tier. Sorted and deduped so the file analysis is stable.
 */
function urlishEnvReads(fileText: string): string[] {
  const names = new Set<string>()
  ENV_READ.lastIndex = 0
  for (const match of fileText.matchAll(ENV_READ)) {
    const name = match[1] ?? match[2]
    if (name && ENV_NAME.test(name) && BASE_URL_HINT.test(name)) names.add(name)
  }
  return [...names].sort()
}
