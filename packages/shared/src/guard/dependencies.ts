/**
 * THE DEPENDENCY CATALOG — the classes of STARTING STATE the program under test
 * needs, and how a scenario may obtain each one.
 *
 * Every scenario runs against some starting state. The catalog names each class of
 * it once and records which of exactly three ways a scenario may get it:
 *
 *   - `step-creatable` — the public surface itself can create it (an init command,
 *     an add command). The preferred way; no seeding needed.
 *   - `seedable` — it cannot be created through public steps but CAN be
 *     materialized deterministically before the steps run: files, configuration,
 *     database rows, an authenticated state.
 *   - `supplied` — a real-world input the engine must never fabricate: a project or
 *     repository the program operates ON, a corpus, credentials to a third-party
 *     system. The catalog declares that the dependency EXISTS; the USER registers
 *     concrete instances.
 *
 * The boundary between the first two and the third is TRANSACTIONAL vs DURABLE: a
 * test may create and mutate transaction-scoped state within its own run (write a
 * row to test writing, dirty a tree to test stashing); anything durable that must
 * pre-exist (a codebase with content, a database already holding data) is supplied.
 *
 * TWO FILES, one merged view — the same split `recipe.json` / `externals.local.json`
 * already uses, for the same reason:
 *   `scenarios/dependencies.json`        COMMITTED. WHAT is needed: the entry, its
 *      class, when it applies, the shape an instance is registered in, and — for a
 *      supplied entry — the REQUIREMENT, contributed flow by flow. It is
 *      fingerprinted with the recipe, so declaring a dependency re-authors the
 *      sections it used to block.
 *   `scenarios/dependencies.local.json`  GITIGNORED. The machine-specific
 *      INSTANCES: a path to a real project, a config dir, an API key. Merged over
 *      the committed entry per FIELD at load time (local wins), and deliberately
 *      outside every fingerprint — registering an instance or rotating a key must
 *      never re-author anything.
 *
 * A supplied dependency with no registered instance is a first-class, user-actionable
 * gap: a scenario binding it settles `blocked` naming the dependency and its
 * requirement. It is never a license for the engine to generate a fake stand-in — a
 * fabricated input would make every verdict reached against it meaningless.
 */

import { z } from 'zod'

/** How a scenario may obtain a class of starting state. See the module doc. */
export const GuardDependencyClassSchema = z.enum(['step-creatable', 'seedable', 'supplied'])
export type GuardDependencyClass = z.infer<typeof GuardDependencyClassSchema>

/**
 * ONE machine-readable gate on a dependency. Closed vocabulary — grown per case,
 * never free-form: a predicate decides whether a flow variant BLOCKS ALONE (the api
 * transport without a key blocks while the claude path still runs), so every member
 * must be evaluable, not merely readable.
 *
 *  - `config-value`      the program is configured a particular way (`llm.transport`
 *                        = `api`);
 *  - `language-present`  the analyzed repo contains that language (C# ⇒ the .NET SDK);
 *  - `command-path`      the flow steps through that interface (a command that shells
 *                        out to a binary only that command needs).
 */
export const GuardDependencyPredicateSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('config-value'),
      /** Dotted config key, as the program names it (`llm.transport`). */
      key: z.string().min(1),
      value: z.string().min(1),
    })
    .strict(),
  z
    .object({ kind: z.literal('language-present'), language: z.string().min(1) })
    .strict(),
  z.object({ kind: z.literal('command-path'), interfaceId: z.string().min(1) }).strict(),
])
export type GuardDependencyPredicate = z.infer<typeof GuardDependencyPredicateSchema>

/**
 * WHEN an entry applies. Structured predicates (all must hold) PLUS a required
 * human sentence: the predicates make a variant block alone, the sentence is what
 * every dashboard surface and CLI line shows. Absent conditionality means the
 * dependency is unconditional — the honest default, never a stand-in for "we did
 * not look".
 */
export const GuardDependencyConditionSchema = z
  .object({
    predicates: z.array(GuardDependencyPredicateSchema).min(1),
    /** Required, human-readable: "only when the LLM transport is `claude-code`". */
    sentence: z.string().min(1),
  })
  .strict()
export type GuardDependencyCondition = z.infer<typeof GuardDependencyConditionSchema>

/**
 * One env var an instance is registered through.
 *
 * `optional` is the one that does not gate: a variable the program has a working
 * default for (a provider's own base URL) is offered so a machine that needs a
 * different one can say so, and left blank otherwise. It is LISTED like any other
 * variable and resolves like any other when registered — it simply never votes on
 * whether the entry is provided. Absent ⇒ required, the honest default.
 */
export const GuardDependencyEnvVarSchema = z
  .object({
    name: z.string().min(1),
    /** What this variable must hold — shown next to the field a user fills in. */
    description: z.string().min(1),
    /** True when the value is a secret, so no surface ever echoes it. */
    secret: z.boolean().default(false),
    /** True when leaving it unregistered is a legitimate answer. See the note above. */
    optional: z.boolean().optional(),
  })
  .strict()
export type GuardDependencyEnvVar = z.infer<typeof GuardDependencyEnvVarSchema>

/**
 * The SHAPE a user registers an instance in — the form the local overlay must fill:
 *
 *  - `env`         one or more env var names the runner sets on the scenario child;
 *  - `path`        a path on this machine, COPIED into the sandbox before the steps
 *                  (never referenced in place, so a run can never mutate the user's
 *                  real data);
 *  - `config-dir`  a configuration directory copied into the sandbox HOME at
 *                  `homePath` — the authenticated-state case. Copy-in, never a
 *                  symlink or a passthrough.
 */
/**
 * A `config-dir` destination that stays INSIDE the sandbox HOME: relative, with no
 * `..` segment. The catalog is committed, so a homePath is repo-supplied input to
 * every machine that runs it — an absolute path or a traversal would direct the
 * recursive copy onto the developer's real filesystem, which is exactly what the
 * copy-in sandbox exists to prevent.
 */
export function isHomeRelativePath(value: string): boolean {
  if (/^([A-Za-z]:)?[\\/]/.test(value)) return false
  return value.split(/[\\/]/).every((seg) => seg !== '..')
}

export const GuardDependencyRegistrationSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('env'), vars: z.array(GuardDependencyEnvVarSchema).min(1) })
    .strict(),
  z
    .object({ kind: z.literal('path'), description: z.string().min(1) })
    .strict(),
  z
    .object({
      kind: z.literal('config-dir'),
      /** Destination inside the sandbox HOME (`.claude`), always HOME-relative. */
      homePath: z
        .string()
        .min(1)
        .refine(isHomeRelativePath, 'a config-dir homePath is HOME-relative and never traverses out (no leading slash, no `..`)'),
      description: z.string().min(1),
    })
    .strict(),
])
export type GuardDependencyRegistration = z.infer<typeof GuardDependencyRegistrationSchema>

/**
 * ONE flow's contribution to a supplied entry's requirement: what THAT flow needs an
 * instance to contain, in one human sentence, attributed to the flow that needs it.
 *
 * The requirement is CONTRIBUTED, never centrally authored, so: the user sees WHY
 * each expectation exists, one shared instance satisfies all binding flows, a
 * dismissed flow's need drops out of the roll-up, and a new flow can GROW the
 * requirement (which may re-trigger instance verification).
 */
export const GuardDependencyNeedSchema = z
  .object({ flowId: z.string().min(1), need: z.string().min(1) })
  .strict()
export type GuardDependencyNeed = z.infer<typeof GuardDependencyNeedSchema>

/** Entry names are stable identities (scenario `needs`, `${supplied:…}` tokens). */
export const DEPENDENCY_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/**
 * Read the pre-list spelling of {@link GuardDependencyEntrySchema}'s service link.
 * A catalog is committed in a user's repository, so an entry that names ONE service
 * as `service` must keep loading — it is the same entry with a one-element
 * `services`. Nothing writes the old field any more.
 */
function foldLegacyService(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const entry = value as Record<string, unknown>
  if (typeof entry.service !== 'string') return value
  const { service, ...rest } = entry
  return rest.services === undefined ? { ...rest, services: [service] } : rest
}

/** One class of starting state. */
const GuardDependencyEntryObject = z
  .object({
    name: z.string().regex(DEPENDENCY_NAME_PATTERN, 'a dependency name is lower-kebab-case'),
    class: GuardDependencyClassSchema,
    /** What this class of state IS, in one line. Always present. */
    summary: z.string().min(1),
    /** When it applies; absent ⇒ unconditional. */
    condition: GuardDependencyConditionSchema.optional(),
    /** How an instance is registered. REQUIRED on a `supplied` entry. */
    registration: GuardDependencyRegistrationSchema.optional(),
    /** The contributed requirement, flow by flow. `supplied` only. */
    needs: z.array(GuardDependencyNeedSchema).default([]),
    /**
     * The external-service identities this entry IS, when it is one or more of them
     * (`anthropic`, `openai`, …). The catalog is the UMBRELLA over external services,
     * so the externals surface joins on this field rather than keeping a parallel
     * registry.
     *
     * A LIST because one class of starting state routinely absorbs several detected
     * services: a single provider-API credential entry stands for every provider the
     * program can reach the model through. Each named service folds into THIS entry —
     * it contributes its detection evidence here and never lists as a row of its own.
     */
    services: z.array(z.string().min(1)).min(1).optional(),
    /**
     * How a `step-creatable` entry is created, or a `seedable` one materialized — one
     * line, so a flow author does not have to rediscover it. Never set on `supplied`,
     * where the answer is the registration shape.
     */
    obtain: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.class === 'supplied') {
      if (!entry.registration) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'a supplied dependency must declare how an instance is registered',
          path: ['registration'],
        })
      }
      if (entry.obtain !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'a supplied dependency is registered, never obtained by the engine',
          path: ['obtain'],
        })
      }
      return
    }
    if (entry.registration) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `only a supplied dependency is registered by the user (this one is ${entry.class})`,
        path: ['registration'],
      })
    }
    if (entry.needs.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `only a supplied dependency carries flow-contributed needs (this one is ${entry.class})`,
        path: ['needs'],
      })
    }
  })

export const GuardDependencyEntrySchema = z.preprocess(
  foldLegacyService,
  GuardDependencyEntryObject,
)
export type GuardDependencyEntry = z.infer<typeof GuardDependencyEntrySchema>

/** The committed catalog file (`scenarios/dependencies.json`). */
export const GuardDependenciesFileSchema = z
  .object({ dependencies: z.array(GuardDependencyEntrySchema).default([]) })
  .strict()
  .superRefine((file, ctx) => {
    const seen = new Set<string>()
    for (const [i, entry] of file.dependencies.entries()) {
      if (seen.has(entry.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate dependency name "${entry.name}"`,
          path: ['dependencies', i, 'name'],
        })
      }
      seen.add(entry.name)
    }
  })
export type GuardDependenciesFile = z.infer<typeof GuardDependenciesFileSchema>

export const EMPTY_GUARD_DEPENDENCIES: GuardDependenciesFile = { dependencies: [] }

// ---------------------------------------------------------------------------
// Request headers — the transport half of an external-service instance
// ---------------------------------------------------------------------------

/** An HTTP field name, as RFC 9110 §5.1 spells one: a token, nothing else. */
export const HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/

/** One header name, validated where it is stored so junk never reaches a file. */
export const HeaderNameSchema = z
  .string()
  .min(1)
  .regex(HEADER_NAME_PATTERN, 'a header name is an HTTP token')

/**
 * Header names whose VALUE is a credential, so no surface ever echoes one back —
 * the same rule the env half already follows, applied to the one place a user can
 * name their own field.
 *
 * It fails CLOSED by design: the test is a substring, so `X-Monkey-Id` is judged
 * secret and simply not shown. Withholding a value that was not a secret costs a
 * reader one retype; echoing one that was is the mistake this whole split exists
 * to prevent.
 */
const SECRET_HEADER_WORDS = [
  'auth',
  'token',
  'secret',
  'key',
  'password',
  'passwd',
  'cookie',
  'credential',
  'signature',
  'session',
]

/** True when this header's value must be treated as a secret. See the rule above. */
export function isSecretHeaderName(name: string): boolean {
  const lower = name.toLowerCase()
  return SECRET_HEADER_WORDS.some((word) => lower.includes(word))
}

/**
 * The GITIGNORED overlay (`scenarios/dependencies.local.json`): the instances. Keyed
 * by entry name; only names (and env vars) the committed catalog DECLARES are
 * honored, so the overlay can never introduce a capability teammates cannot see.
 *
 * `token` and `headers` are the exception to "only what the catalog declares", and
 * deliberately so: they are TRANSPORT detail of one machine's account (a bearer
 * token, a tenant header), never a capability, and the committed catalog has no
 * business naming them. Like every other field here they are outside every
 * fingerprint, so rotating a token re-authors nothing.
 */
export const GuardDependenciesLocalSchema = z.record(
  z.string().min(1),
  z
    .object({
      /** An absolute-or-repo-relative host path — `path` and `config-dir` shapes. */
      path: z.string().min(1).optional(),
      /** Values for the declared env vars — the `env` shape. */
      env: z.record(z.string().min(1), z.string()).optional(),
      /** The authorization token an external-service entry authenticates with. */
      token: z.string().optional(),
      /** Extra request headers an external-service entry is reached with. */
      headers: z.record(HeaderNameSchema, z.string()).optional(),
    })
    .strict(),
)
export type GuardDependenciesLocal = z.infer<typeof GuardDependenciesLocalSchema>

// ---------------------------------------------------------------------------
// The rolled-up requirement
// ---------------------------------------------------------------------------

/** The requirement of a supplied entry, rolled up from its per-flow needs. */
export interface GuardDependencyRequirement {
  /** The needs that still count (dismissed flows dropped), in catalog order. */
  needs: GuardDependencyNeed[];
  /** One line a CLI or a chip can print: the needs joined, else the summary. */
  sentence: string;
}

/**
 * Roll a supplied entry's contributed needs up into the requirement every surface
 * shows. A flow in `dismissedFlows` drops out — its expectation dies with it — and
 * an entry left with no needs falls back to its own `summary`, which is always
 * present, so a requirement is never blank.
 */
export function rollUpRequirement(
  entry: GuardDependencyEntry,
  dismissedFlows: ReadonlySet<string> = new Set(),
): GuardDependencyRequirement {
  const needs = entry.needs.filter((n) => !dismissedFlows.has(n.flowId))
  if (needs.length === 0) return { needs, sentence: entry.summary }
  return { needs, sentence: needs.map((n) => n.need).join('; ') }
}

// ---------------------------------------------------------------------------
// The `${supplied:…}` token
// ---------------------------------------------------------------------------

/**
 * `${supplied:<name>.<field>}` — how a scenario reaches a registered instance. The
 * runner resolves it against the overlay AFTER it has materialized the instance
 * inside the sandbox, so the value a step sees is the sandbox copy, never the host
 * original. A token whose dependency has no registered instance never reaches a
 * child: the scenario settles `blocked` first (see the runner's gate), so a literal
 * `${supplied:…}` can never appear in an argv, an env value, or a seeded file.
 *
 * `field` is `path` for the `path` / `config-dir` shapes, or a declared env var name
 * for the `env` shape.
 */
export const SUPPLIED_TOKEN = /\$\{supplied:([a-z0-9][a-z0-9-]*)\.([A-Za-z0-9_.-]+)\}/g

/** Every `<name, field>` a string references, in first-seen order. */
export function suppliedTokenRefs(value: string): { name: string; field: string }[] {
  const out: { name: string; field: string }[] = []
  const seen = new Set<string>()
  for (const m of value.matchAll(SUPPLIED_TOKEN)) {
    const key = `${m[1]} ${m[2]}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name: m[1], field: m[2] })
  }
  return out
}

/**
 * Every dependency name referenced anywhere in `value` (sorted, deduped). Object
 * KEYS are walked too, exactly as `capturedNamesIn` walks them: a `setup.files` or
 * `expect.files` key is a path the runner interpolates, so a token there is a real
 * binding and must gate the run like any other.
 */
export function suppliedNamesIn(value: unknown): string[] {
  const names = new Set<string>()
  const addFrom = (text: string): void => {
    for (const ref of suppliedTokenRefs(text)) names.add(ref.name)
  }
  const walk = (node: unknown): void => {
    if (typeof node === 'string') return addFrom(node)
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (node && typeof node === 'object') {
      for (const [key, item] of Object.entries(node)) {
        addFrom(key)
        walk(item)
      }
    }
  }
  walk(value)
  return [...names].sort()
}
