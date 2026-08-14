/**
 * ONE-OFF: migrate a HAND-AUTHORED `interfaces.json` from v1 to v2 (the SOM
 * restructure, plan item 98).
 *
 * The derived catalogs need no migration — `guard/interfaces.json` is gitignored
 * and re-derived, so a v1 file simply fails to parse and the next map rewrites
 * it. The two catalogs that DO need one are the hand-authored reference corpora
 * under `reference/`, which are committed, expensive, and pinned by tests.
 *
 * What it does, per entry:
 *
 *  - **cli** — `contract.commands[0]` becomes the singular `contract.command`,
 *    under `surface: 'cli'`. Nothing else moves.
 *  - **api** — the cli COSTUME becomes an operation. The costume's `path` was
 *    `["GET", "/x"]` (identity the entry already carries, so it is dropped);
 *    positionals were path parameters; options were query parameters or JSON
 *    body fields, told apart by the sentence the author opened each description
 *    with; `io.produces.output` markers on `stream: "stdout"` were response-body
 *    markers; `io.produces.exits` were HTTP statuses; `io.consumes.env|reads`
 *    and `io.produces.writes` were already themselves and are carried verbatim.
 *  - **web** — untouched, byte for byte: entries, states and resources.
 *
 * Then it forms the cli and api RESOURCES with the same
 * `@truecourse/interface-mapper` rules a derived catalog gets, and points each
 * entry's `resource` at its owner. Fingerprints are never touched — the whole
 * restructure is outside the fold, and the pinned reference tests are the proof.
 *
 * Usage: `pnpm tsx scripts/migrate-interfaces-v2.ts <path-to-interfaces.json>…`
 */

import fs from 'node:fs'
import { formApiResources, formCliResources } from '../packages/interface-mapper/src/resources.js'
import { InterfacesFileSchema, type Interface, type InterfaceResource } from '@truecourse/shared'

/** How the reference author opened the description of a body field. */
const BODY_MARKER = /^JSON body field\./
/** …and of a query parameter. */
const QUERY_MARKER = /^Query parameter\./

interface V1Option {
  flag: string
  short?: string
  takesValue: boolean
  valueRequired: boolean
  valueHint?: string
  choices?: string[]
  default?: string | number | boolean
  scope?: string
  hidden?: boolean
  description?: string
}

interface V1Positional {
  name: string
  required: boolean
  variadic?: boolean
  description?: string
}

type Json = Record<string, unknown>

function requestField(option: V1Option): Json {
  return {
    name: option.flag,
    required: option.valueRequired,
    ...(option.valueHint ? { hint: option.valueHint } : {}),
    ...(option.choices ? { choices: option.choices } : {}),
    ...(option.default !== undefined ? { default: option.default } : {}),
    ...(option.description ? { description: option.description.replace(/^[^.]+\.\s*/, '') } : {}),
  }
}

function paramField(positional: V1Positional): Json {
  return {
    name: positional.name,
    required: positional.required,
    ...(positional.description ? { description: positional.description } : {}),
  }
}

/** The api costume → the native operation. */
function toOperation(command: Json): Json {
  const options = (command.options ?? []) as V1Option[]
  const positionals = (command.positionals ?? []) as V1Positional[]
  const io = (command.io ?? {}) as { consumes?: Json; produces?: Json }
  const consumes = (io.consumes ?? {}) as { env?: unknown[]; reads?: unknown[] }
  const produces = (io.produces ?? {}) as {
    output?: { stream: string; marker: string; when?: string }[]
    exits?: { exit: string; when?: string }[]
    writes?: unknown[]
  }

  const body = options.filter((o) => BODY_MARKER.test(o.description ?? ''))
  const query = options.filter((o) => QUERY_MARKER.test(o.description ?? ''))
  const unclassified = options.filter((o) => !body.includes(o) && !query.includes(o))
  if (unclassified.length > 0) {
    throw new Error(
      `option(s) ${unclassified.map((o) => o.flag).join(', ')} say neither "Query parameter." nor "JSON body field." — where do they go?`,
    )
  }

  const request: Json = {
    ...(command.positionals !== undefined ? { params: positionals.map(paramField) } : {}),
    ...(command.options !== undefined ? { query: query.map(requestField), body: body.map(requestField) } : {}),
  }

  const operationProduces: Json = {
    ...(produces.exits
      ? { statuses: produces.exits.map((e) => ({ status: e.exit, ...(e.when ? { when: e.when } : {}) })) }
      : {}),
    ...(produces.output
      ? { body: produces.output.map((o) => ({ marker: o.marker, ...(o.when ? { when: o.when } : {}) })) }
      : {}),
    ...(produces.writes ? { writes: produces.writes } : {}),
  }
  const operationConsumes: Json = {
    ...(consumes.env ? { env: consumes.env } : {}),
    ...(consumes.reads ? { reads: consumes.reads } : {}),
  }

  return {
    ...(command.description ? { description: command.description } : {}),
    ...(Object.keys(request).length > 0 ? { request } : {}),
    ...(Object.keys(operationConsumes).length > 0 ? { consumes: operationConsumes } : {}),
    ...(Object.keys(operationProduces).length > 0 ? { produces: operationProduces } : {}),
  }
}

function migrateContract(type: string, contract: Json | undefined): Json | undefined {
  if (!contract) return undefined
  const commands = contract.commands as Json[] | undefined
  if (!commands || commands.length !== 1) {
    throw new Error(`a v1 contract carries exactly one command; found ${commands?.length ?? 0}`)
  }
  const command = commands[0]!
  const summary = contract.summary ? { summary: contract.summary } : {}
  if (type === 'cli') return { surface: 'cli', ...summary, command }
  if (type === 'api') return { surface: 'api', ...summary, operation: toOperation(command) }
  throw new Error(`a \`${type}\` interface carries a contract, and there is no member for that surface`)
}

function migrate(file: string): void {
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
    version: number
    interfaces: Json[]
    resources?: Record<string, InterfaceResource[]>
    [key: string]: unknown
  }
  if (raw.version === 2) {
    console.log(`${file}: already v2`)
    return
  }

  const before = raw.interfaces.map((j) => j.fingerprint)

  const interfaces = raw.interfaces.map((j) => ({
    ...j,
    ...(j.contract ? { contract: migrateContract(j.type as string, j.contract as Json) } : {}),
  }))

  // The places, by the same rules a derived catalog gets. The program name comes
  // from the root interface the reference catalog carries; a catalog without one
  // forms its nested groups and leaves the top level unowned.
  const typed = interfaces as unknown as Interface[]
  const programName = typed.find((j) => j.type === 'cli' && j.id === 'cli/root')?.title
  const cli = formCliResources(typed, { ...(programName ? { programName } : {}) })
  const api = formApiResources(typed)

  const owners = new Map([...cli.owners, ...api.owners])
  const placed = interfaces.map((j) => {
    const owner = owners.get(j.id as string)
    if (!owner) return j
    // `resource` sits with the other place references, before the fingerprint.
    const { fingerprint, specOnly, contract, ...head } = j
    return {
      ...head,
      resource: owner,
      ...(fingerprint !== undefined ? { fingerprint } : {}),
      ...(specOnly !== undefined ? { specOnly } : {}),
      ...(contract !== undefined ? { contract } : {}),
    }
  })

  const resources = {
    ...(cli.resources.length > 0 ? { cli: cli.resources } : {}),
    ...(api.resources.length > 0 ? { api: api.resources } : {}),
    ...(raw.resources ?? {}),
  }

  const next = {
    ...raw,
    version: 2,
    interfaces: placed,
    ...(Object.keys(resources).length > 0 ? { resources } : {}),
  }

  const parsed = InterfacesFileSchema.parse(next)
  const after = parsed.interfaces.map((j) => j.fingerprint)
  if (before.join('\n') !== after.join('\n')) {
    throw new Error('a fingerprint moved — the migration touched identity, which it must never do')
  }

  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`)
  console.log(
    `${file}: v2 — ${placed.length} interfaces, ${cli.resources.length} command groups, ${api.resources.length} rest nouns`,
  )
}

const targets = process.argv.slice(2)
if (targets.length === 0) {
  console.error('usage: tsx scripts/migrate-interfaces-v2.ts <interfaces.json>…')
  process.exit(1)
}
for (const target of targets) migrate(target)
