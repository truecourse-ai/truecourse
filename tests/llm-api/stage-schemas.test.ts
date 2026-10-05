/**
 * THE GATE ON EVERY SCHEMA A MODEL IS SENT.
 *
 * Every tool a session can call and every session outcome reaches a provider
 * as a JSON Schema: the api driver sends each as a tool's input schema, the
 * Agent SDK driver sends the outcome as `outputFormat`. A provider validates
 * that schema before it reads the prompt and refuses the whole call when it
 * cannot take it, so one bad schema is an outage for its stage.
 *
 * Tools and session kinds register themselves when their module loads, so
 * this file loads every module that declares one and checks the registry, not
 * a hand list. Each schema is sent through the real driver and the real
 * provider SDK against a fake `fetch`, and the rules below are checked on the
 * request body the SDK actually built, for every provider. The rules are the
 * subset every provider accepts: the one schema rule is that a tool or an
 * outcome must be expressible in OpenAI's strict mode. A schema the SDK
 * refuses to build a request from at all breaks the rule `sdk-refused`.
 *
 * Strictness is checked on the same bodies: OpenAI is asked to enforce every
 * tool, its schemas normalized to all-required; Gemini every tool except in a
 * request carrying a schema its owner declared large (Gemini cannot compile
 * those, see its provider tuning); Anthropic, Bedrock and Copilot are sent no
 * `strict` at all.
 */

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import Ajv2020 from 'ajv/dist/2020.js'
import {
  registeredSessionKinds,
  registeredToolSpecs,
  type SessionDef,
  type SessionDriver,
} from '@truecourse/agent-loop'
import { createApiSessionDriver } from '../../packages/llm-api/src/session-driver'
import { registeredProviders } from '../../packages/llm-api/src/providers/index'
import type { LlmProviderKind, ProviderConfig } from '../../packages/llm-api/src/types'
import { createClaudeAgentSessionDriver } from '../../packages/llm-claude-agent/src/session-driver'
import type { SdkModule, SdkQueryOptions } from '../../packages/llm-claude-agent/src/sdk-types'
import { assertOpenAiStrictValid } from './strict-assert'

const ROOT = path.resolve(__dirname, '../..')

/** Every module that declares a tool spec or a session kind, repo-relative. */
const MODULES = [
  'packages/core/src/services/agent/repo-tools.ts',
  'packages/core/src/services/guard-adjudicate/control.ts',
  'packages/core/src/services/guard-adjudicate/session.ts',
  'packages/core/src/services/guard-adjudicate/tools.ts',
  'packages/core/src/services/guard-generate/extract.ts',
  'packages/core/src/services/guard-generate/fidelity.ts',
  'packages/core/src/services/guard-generate/flow-worker.ts',
  'packages/core/src/services/guard-generate/flows.ts',
  'packages/core/src/services/guard-generate/leaf-sessions.ts',
  'packages/core/src/services/guard-generate/tools.ts',
  'packages/core/src/services/guard-setup/auth-proof.ts',
  'packages/core/src/services/guard-setup/dependency-catalog.ts',
  'packages/core/src/services/guard-setup/preparation-diagnostics.ts',
  'packages/core/src/services/guard-setup/preparation-observation.ts',
  'packages/core/src/services/guard-setup/preparation-session.ts',
  'packages/core/src/services/guard-setup/recipe-propose.ts',
  'packages/core/src/services/guard-setup/recipe-repair.ts',
  'packages/core/src/services/guard-setup/reconcile-interfaces.ts',
  'packages/core/src/services/guard-setup/seed-session.ts',
  'packages/core/src/services/interface-author/live-screen.ts',
  'packages/core/src/services/interface-author/reconcile.ts',
  'packages/core/src/services/interface-author/session.ts',
  'packages/core/src/services/interface-author/tools.ts',
  'packages/core/src/services/llm/guard-visual-judge.ts',
  'packages/core/src/services/product-world/flow-test-session.ts',
  'packages/core/src/services/product-world/world-session.ts',
  'packages/core/src/services/spec-scan/compare-facts.ts',
  'packages/core/src/services/spec-scan/corpus-review.ts',
  'packages/core/src/services/spec-scan/curate-doc.ts',
  'packages/core/src/services/spec-scan/orchestrate.ts',
  'packages/core/src/services/spec-scan/overlap.ts',
  'packages/core/src/services/spec-scan/record-facts.ts',
  'packages/core/src/services/spec-scan/settle-areas.ts',
  'packages/core/src/services/spec-scan/settle-subjects.ts',
  'packages/core/src/services/spec-scan/tools.ts',
]

// ---------------------------------------------------------------------------
// what each provider's request body carries
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>

/** Marks a tool that carries no `strict` field at all. */
const ABSENT = Symbol('absent')

interface WireTool {
  name: string
  schema: unknown
  strict: unknown
}

const isJson = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function json(value: unknown, what: string): Json {
  if (!isJson(value)) throw new Error(`${what} is not an object`)
  return value
}

function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${what} is not an array`)
  return value
}

const strictOf = (tool: Json): unknown => ('strict' in tool ? tool.strict : ABSENT)

/** Where each provider's SDK puts the tools in the request it sends. */
const WIRE_TOOLS: Record<LlmProviderKind, (body: Json) => WireTool[]> = {
  anthropic: (body) =>
    list(body.tools, 'tools').map((t) => {
      const tool = json(t, 'tool')
      return { name: String(tool.name), schema: tool.input_schema, strict: strictOf(tool) }
    }),
  openai: (body) =>
    list(body.tools, 'tools').map((t) => {
      const tool = json(t, 'tool')
      return { name: String(tool.name), schema: tool.parameters, strict: strictOf(tool) }
    }),
  copilot: (body) =>
    list(body.tools, 'tools').map((t) => {
      const fn = json(json(t, 'tool').function, 'tool.function')
      return { name: String(fn.name), schema: fn.parameters, strict: strictOf(fn) }
    }),
  bedrock: (body) =>
    list(json(body.toolConfig, 'toolConfig').tools, 'toolConfig.tools').map((t) => {
      const spec = json(json(t, 'tool').toolSpec, 'toolSpec')
      return { name: String(spec.name), schema: json(spec.inputSchema, 'inputSchema').json, strict: strictOf(spec) }
    }),
  // Gemini takes strictness for the whole request, as the function-calling mode.
  google: (body) => {
    const mode = isJson(body.toolConfig) && isJson(body.toolConfig.functionCallingConfig)
      ? body.toolConfig.functionCallingConfig.mode
      : undefined
    return list(body.tools, 'tools').flatMap((group) =>
      list(json(group, 'tools[]').functionDeclarations, 'functionDeclarations').map((d) => {
        const declaration = json(d, 'functionDeclaration')
        return {
          name: String(declaration.name),
          schema: declaration.parametersJsonSchema,
          strict: mode === 'VALIDATED' ? true : ABSENT,
        }
      }),
    )
  },
}

/** A config each registered provider is exercised with; no key is ever real. */
const CONFIGS: Record<LlmProviderKind, ProviderConfig> = {
  anthropic: { provider: 'anthropic', model: 'claude-opus-5-5', apiKey: 'test' },
  openai: { provider: 'openai', model: 'gpt-6-sol', apiKey: 'test' },
  copilot: { provider: 'copilot', model: 'gpt-6-sol', apiKey: 'test' },
  bedrock: {
    provider: 'bedrock',
    model: 'us.anthropic.claude-opus-5-5-v1:0',
    region: 'us-east-1',
    accessKeyId: 'AKIATEST',
    secretAccessKey: 'test',
  },
  google: { provider: 'google', model: 'gemini-3.8-flash', apiKey: 'test' },
}

const BUDGET = { turns: 1, maxResumes: 0, tokenCeiling: 1_000 }

/**
 * Run `def` once through `driver` and hand back the body its one request
 * carried, or why the SDK refused to build that request at all.
 */
async function requestBody(driver: SessionDriver, def: SessionDef): Promise<{ body: Json } | { refused: string }> {
  let sent: Json | undefined
  vi.stubGlobal('fetch', async (_url: unknown, init: { body: string }) => {
    sent = json(JSON.parse(init.body), 'request body')
    // A refusal the driver does not retry ends the session after one call.
    return new Response(JSON.stringify({ error: { message: 'gate' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  })
  const result = await driver.runSession({
    def,
    initialMessages: ['go'],
    onEvent: () => {},
    signal: new AbortController().signal,
  }).done
  if (sent) return { body: sent }
  if (result.kind === 'failure') {
    return { refused: 'detail' in result.failure ? result.failure.detail : result.failure.kind }
  }
  throw new Error(`${def.kind}: nothing reached fetch`)
}

// ---------------------------------------------------------------------------
// the rules
// ---------------------------------------------------------------------------

const MAX_NESTING = 10
const MAX_PROPERTIES = 5_000
const LOOKAROUND = /\(\?<?[=!]/
const ajv = new Ajv2020({ strict: false })

/** Every sub-schema of `node`, with its path. */
function children(node: Json, at: string): Array<[unknown, string]> {
  const out: Array<[unknown, string]> = []
  for (const key of ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']) {
    const map = node[key]
    if (isJson(map)) for (const [name, child] of Object.entries(map)) out.push([child, `${at}.${key}.${name}`])
  }
  for (const key of ['anyOf', 'oneOf', 'allOf', 'prefixItems']) {
    const branches = node[key]
    if (Array.isArray(branches)) branches.forEach((child, i) => out.push([child, `${at}.${key}[${i}]`]))
  }
  if (Array.isArray(node.items)) node.items.forEach((child, i) => out.push([child, `${at}.items[${i}]`]))
  for (const key of ['items', 'additionalProperties', 'additionalItems', 'propertyNames', 'contains', 'not', 'if', 'then', 'else']) {
    if (isJson(node[key])) out.push([node[key], `${at}.${key}`])
  }
  return out
}

const isObjectNode = (node: Json): boolean =>
  node.type === 'object' || (Array.isArray(node.type) && node.type.includes('object')) || isJson(node.properties)

/** A sub-schema that constrains nothing: `{}`, or one with no type of any kind. */
const isOpen = (node: Json): boolean =>
  !['type', 'anyOf', 'oneOf', 'allOf', '$ref', 'enum', 'const', 'not'].some((key) => key in node)

/** The rules one wire schema breaks, as `rule at path`. */
function violations(schema: unknown): Array<{ rule: string; at: string }> {
  const found: Array<{ rule: string; at: string }> = []
  const flag = (rule: string, at: string): void => void found.push({ rule, at })
  if (!isJson(schema)) return [{ rule: 'not-an-object', at: '(root)' }]

  const { $schema: _dialect, ...body } = schema
  if (!ajv.validateSchema(body)) flag('meta-schema', ajv.errorsText(ajv.errors))

  const visit = (node: unknown, at: string): void => {
    if (!isJson(node)) {
      if (node === true) flag('open-schema', at)
      return
    }
    if (isOpen(node)) flag('open-schema', at)
    if (Array.isArray(node.items)) flag('tuple-items', at)
    if ('prefixItems' in node) flag('prefixItems', at)
    if ('additionalProperties' in node ? node.additionalProperties !== false : isObjectNode(node)) flag('open-object', at)
    for (const keyword of ['oneOf', 'allOf', 'uniqueItems', 'propertyNames'] as const) {
      if (keyword in node) flag(keyword, at)
    }
    if (node.format === 'uri') flag('format-uri', at)
    if (typeof node.pattern === 'string' && LOOKAROUND.test(node.pattern)) flag('pattern-lookaround', at)
    for (const [child, childAt] of children(node, at)) visit(child, childAt)
  }
  visit(schema, '(root)')

  const shape = expandedShape(schema)
  if (shape.depth > MAX_NESTING) flag('nesting', `${shape.depth} levels`)
  if (shape.properties > MAX_PROPERTIES) flag('property-count', `${shape.properties} properties`)
  return found
}

/** Object nesting depth and total property count, with local `$ref`s followed. */
function expandedShape(root: Json): { depth: number; properties: number } {
  const defs = isJson(root.$defs) ? root.$defs : {}
  let properties = 0
  const walk = (node: unknown, refs: ReadonlySet<string>): number => {
    if (!isJson(node)) return 0
    if (typeof node.$ref === 'string') {
      const name = node.$ref.replace('#/$defs/', '')
      if (refs.has(name)) return 0
      return walk(defs[name], new Set([...refs, name]))
    }
    if (isJson(node.properties)) properties += Object.keys(node.properties).length
    const below = children(node, '')
      .filter(([, at]) => !at.startsWith('.$defs') && !at.startsWith('.definitions'))
      .map(([child]) => walk(child, refs))
    return (isObjectNode(node) ? 1 : 0) + Math.max(0, ...below)
  }
  return { depth: walk(root, new Set()), properties }
}

// ---------------------------------------------------------------------------
// what the gate sends
// ---------------------------------------------------------------------------

/** A stable id per registered schema; a name shared by several specs is numbered. */
function numbered<T>(items: readonly T[], label: (item: T) => string): Array<{ id: string; item: T }> {
  const seen = new Map<string, number>()
  return items.map((item) => {
    const base = label(item)
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return { id: n === 1 ? base : `${base}#${n}`, item }
  })
}

interface Sent {
  /** `api:<provider>` or `claude-agent`. */
  via: string
  id: string
  /** What reached the wire, or why the SDK built no request from it. */
  wire: WireTool | { refused: string }
}

const sent: Sent[] = []
/** The ids of the schemas their owners declare large. */
const declaredLarge = new Set<string>()

/**
 * The schemas Gemini refuses to enforce, by id. It compiles a strict schema
 * into a constrained decoder whose size limit is undocumented, so this set is
 * what was measured live, and growing it is a decision to verify live too.
 */
const LARGE_SCHEMAS = ['outcome:guard-generate.flow-worker', 'tool:check_draft']

/** The smallest schema Gemini is known to refuse, in bytes with local refs inlined. */
const SMALLEST_REFUSED_BYTES = 87_916

/** A schema's size with every local `$ref` inlined, the way a decoder compiles it. */
function expandedBytes(root: Json): number {
  const defs = isJson(root.$defs) ? root.$defs : {}
  const inline = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(inline)
    if (!isJson(node)) return node
    if (typeof node.$ref === 'string' && node.$ref.startsWith('#/$defs/')) {
      return inline(defs[node.$ref.slice('#/$defs/'.length)])
    }
    return Object.fromEntries(Object.entries(node).filter(([key]) => key !== '$defs').map(([key, value]) => [key, inline(value)]))
  }
  return JSON.stringify(inline(root)).length
}

beforeAll(async () => {
  for (const module of MODULES) await import(path.join(ROOT, module))

  const kinds = numbered(registeredSessionKinds(), (k) => `outcome:${k.kind}`)
  for (const { id, item } of kinds) if (item.largeOutcomeSchema) declaredLarge.add(id)
  // One tool per request, so a tool the SDK refuses is named by its own refusal.
  const specs = numbered(registeredToolSpecs(), (s) => `tool:${s.name}`)
  for (const { id, item } of specs) if (item.largeInputSchema) declaredLarge.add(id)
  const tools = specs.map(({ id, item }) => ({
    id,
    name: item.name,
    def: {
      kind: 'gate.tool',
      systemPrompt: 'gate',
      tools: [item.bind({ execute: async () => ({ content: '' }) })],
      outcomeSchema: z.object({ done: z.boolean() }).strict(),
      budget: BUDGET,
    } satisfies SessionDef,
  }))

  for (const { kind: provider } of registeredProviders()) {
    const driver = createApiSessionDriver(CONFIGS[provider], { retry: { attempts: 1 } })
    const via = `api:${provider}`
    const wireTool = async (id: string, def: SessionDef, name: string): Promise<void> => {
      const request = await requestBody(driver, def)
      const wire = 'refused' in request ? request : WIRE_TOOLS[provider](request.body).find((t) => t.name === name)
      if (!wire) throw new Error(`${via} ${id}: \`${name}\` is not on the wire`)
      sent.push({ via, id, wire })
    }
    for (const { id, item } of kinds) {
      await wireTool(id, { ...item, systemPrompt: 'gate', tools: [], budget: BUDGET }, 'outcome')
    }
    for (const { id, name, def } of tools) await wireTool(id, def, name)
  }

  // The Agent SDK driver sends the outcome schema as `outputFormat`; a fake
  // SDK records the options the driver hands it and ends the session.
  for (const { id, item } of kinds) {
    let options: SdkQueryOptions | undefined
    const sdk: SdkModule = {
      tool: () => ({}),
      createSdkMcpServer: () => ({}),
      query: (params) => {
        options = params.options
        return Object.assign((async function* () {})(), { interrupt: async () => undefined })
      },
    }
    const driver = createClaudeAgentSessionDriver({ sdk, pathToClaudeCodeExecutable: 'claude' })
    await driver.runSession({
      def: { ...item, systemPrompt: 'gate', tools: [], budget: BUDGET },
      initialMessages: ['go'],
      onEvent: () => {},
      signal: new AbortController().signal,
    }).done
    if (!options?.outputFormat) throw new Error(`claude-agent ${id}: no outputFormat`)
    sent.push({ via: 'claude-agent', id, wire: { name: 'outputFormat', schema: options.outputFormat.schema, strict: ABSENT } })
  }
}, 120_000)

afterEach(() => vi.unstubAllGlobals())

describe('the schemas every provider is sent', () => {
  it('come from every module that declares a tool or a session kind', () => {
    const declaring: string[] = []
    const scan = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) scan(full)
        else if (/\.tsx?$/.test(entry.name) && /\bdefine(?:ToolSpec|SessionKind)\(\{/.test(fs.readFileSync(full, 'utf8'))) {
          declaring.push(path.relative(ROOT, full))
        }
      }
    }
    for (const top of ['packages', 'ee']) scan(path.join(ROOT, top))
    expect(declaring.sort()).toEqual([...MODULES].sort())
  })

  it('cover every registered tool and session kind on every provider', () => {
    const ids = new Set(sent.map((s) => s.id))
    expect(ids.size).toBe(registeredToolSpecs().length + registeredSessionKinds().length)
    for (const via of registeredProviders().map((p) => `api:${p.kind}`)) {
      expect(sent.filter((s) => s.via === via).length, via).toBe(ids.size)
    }
  })

  it('ask OpenAI to enforce every tool, Gemini every tool short of a declared-large schema, and no other provider', () => {
    // What the body carries, not what was passed: the OpenAI SDK writes
    // `strict: false` for a tool given none, so only a literal `true` counts.
    const strictness = sent
      .filter((s) => s.via.startsWith('api:'))
      .map(({ via, id, wire }) => `${via} ${id} ${'refused' in wire ? 'refused' : wire.strict === ABSENT ? 'absent' : String(wire.strict)}`)
    const expected = (via: string, id: string) =>
      via === 'api:openai' || (via === 'api:google' && !declaredLarge.has(id)) ? 'true' : 'absent'
    expect(strictness).toEqual(sent.filter((s) => s.via.startsWith('api:')).map(({ via, id }) => `${via} ${id} ${expected(via, id)}`))
  })

  it('declare large exactly the schemas Gemini is known to refuse', () => {
    expect([...declaredLarge].sort()).toEqual(LARGE_SCHEMAS)
  })

  it('declare large every schema as big as one Gemini is known to refuse', () => {
    const undeclared = sent
      .filter((s) => s.via === 'api:google' && !('refused' in s.wire) && !declaredLarge.has(s.id))
      .map(({ id, wire }) => ({ id, bytes: 'refused' in wire ? 0 : expandedBytes(json(wire.schema, id)) }))
      .filter(({ bytes }) => bytes >= SMALLEST_REFUSED_BYTES)
      .map(({ id, bytes }) => `${id}: ${bytes} bytes with refs inlined`)
    expect(
      undeclared,
      'declare these large (largeInputSchema / largeOutcomeSchema), verify live that Gemini refuses them in VALIDATED, and add them to LARGE_SCHEMAS',
    ).toEqual([])
  })

  it('send OpenAI every property required, optionals widened to null', () => {
    for (const { id, wire } of sent.filter((s) => s.via === 'api:openai')) {
      if ('refused' in wire) throw new Error(`${id}: ${wire.refused}`)
      assertOpenAiStrictValid(wire.schema, id)
    }
  })

  it('break no rule', () => {
    const broken = sent.flatMap(({ via, id, wire }) =>
      ('refused' in wire ? [{ rule: 'sdk-refused', at: wire.refused }] : violations(wire.schema)).map(
        ({ rule, at }) => `${id} ${rule} (${via} at ${at})`,
      ),
    )
    expect(broken).toEqual([])
  })
})
