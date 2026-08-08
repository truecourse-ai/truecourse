/**
 * EXTERNAL SERVICES — the third-party systems the analyzed app itself depends on,
 * identified by NAME (`stripe`, `sendgrid`) rather than reduced to the boolean
 * "this file talks to something external" the layer detector needs.
 *
 * Shared (not under `guard/`) because the shape is an ANALYSIS fact: the detector
 * lives in `@truecourse/analyzer` (it reads the import-pattern registry), while
 * `guard-generator` — which cannot see the analyzer — consumes it through this
 * type, and `guard/report.ts` snapshots it. One shape, three packages.
 *
 * Detection has TWO sources (see {@link ExternalServiceSourceSchema}): an SDK import
 * matched against the pattern registry, and a bare http(s) URL literal pointing at
 * a third-party host. Either way it is a claim about what the SOURCE says, not about
 * egress at run time: a service imported (or written into a URL) but never called
 * still appears.
 */

import { z } from 'zod'

/**
 * The kind of third party, from the registry section the match came from. Kept so
 * consumers can de-emphasize the categories that are commonly FIRST-party infra
 * (an `auth` library like passport, a `queue` backed by the repo's own Redis) next
 * to the ones that are unambiguously someone else's server (`payment`, `messaging`).
 *
 * There is deliberately no `http` member: a bare HTTP client (axios, requests) is
 * TRANSPORT, not a service identity — see {@link DetectedExternalService}.
 */
export const ExternalServiceCategorySchema = z.enum([
  'payment',
  'messaging',
  'cloud',
  'ai',
  'auth',
  'queue',
])
export type ExternalServiceCategory = z.infer<typeof ExternalServiceCategorySchema>

/**
 * HOW a service was identified. `sdk` = an import matched the pattern registry;
 * `http` = a plain http(s) request to its host, with no SDK anywhere — the case
 * that made the field necessary, because such a service has no registry entry and
 * therefore no {@link ExternalServiceCategory}; `binary` = the program SPAWNS it as
 * a subprocess (`claude`, `git`, `dotnet`), which import and URL scanning can never
 * see and which reading as `sdk` would misdescribe — a spawned binary is not a
 * library the program links, it is an executable the machine must already have.
 *
 * Optional on the shape: data written before HTTP detection existed carries no
 * `source` and reads as `sdk`, which is what it was.
 */
export const ExternalServiceSourceSchema = z.enum(['sdk', 'http', 'binary'])
export type ExternalServiceSource = z.infer<typeof ExternalServiceSourceSchema>

/**
 * Where a service was seen: the file, plus whichever pointer named it — the import
 * specifier (SDK detection), the URL literal (HTTP detection), or the binary name
 * (spawn detection). Exactly one of the three is present; all are optional so each
 * detector writes only what it knows.
 */
export const ExternalServiceEvidenceSchema = z
  .object({
    filePath: z.string().min(1),
    importSource: z.string().min(1).optional(),
    /** The http(s) URL literal that named the host, for `http`-source detection. */
    url: z.string().min(1).optional(),
    /** The executable this site spawns, for `binary`-source detection (`claude`). */
    binary: z.string().min(1).optional(),
    /**
     * The lookup chain the binary is resolved through, in precedence order, ending
     * with how it is found when no override is set (`PATH`, or the directory a
     * package manager installs it into). Recorded only at the site that ESTABLISHES
     * the chain — a call site that merely uses the resolver carries the binary name
     * alone — because a chain copied to every caller would claim more than the file
     * says. An override the user can set is the difference between "install this" and
     * "point us at your copy", so it is part of the evidence, not a footnote.
     */
    resolvedFrom: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()
export type ExternalServiceEvidence = z.infer<typeof ExternalServiceEvidenceSchema>

/**
 * One env var that overrides a service's base URL, with WHY we believe it does:
 * - `literal-fallback` — the source structurally binds it to a URL literal for this
 *   service (`process.env.FOO ?? 'https://host'`, or a defaults map keyed by the
 *   variable name). `defaultUrl` is that literal.
 * - `name-heuristic` — only the NAME says so (it carries a service token and one of
 *   URL/URI/BASE/HOST/ENDPOINT). No default URL, and a weaker claim.
 */
export const BaseUrlEnvSchema = z
  .object({
    envVar: z.string().min(1),
    /** The URL the app falls back to when the variable is unset, when it is visible. */
    defaultUrl: z.string().min(1).optional(),
    confidence: z.enum(['literal-fallback', 'name-heuristic']),
  })
  .strict()
export type BaseUrlEnv = z.infer<typeof BaseUrlEnvSchema>

/**
 * One detected third party. `service` is the CANONICAL registry name (`stripe`,
 * `aws-sqs`) — the identity that gets stamped into a blocked-on gap reason and
 * tallied per service, so it must be stable across runs and repos.
 */
export const DetectedExternalServiceSchema = z
  .object({
    service: z.string().min(1),
    /**
     * The registry section the SDK match came from. OPTIONAL: a service detected
     * only from a bare HTTP call has no registry entry, so its kind is genuinely
     * UNKNOWN — and inventing a category (`http`) to fill the hole would name a
     * transport, not a kind of third party.
     */
    category: ExternalServiceCategorySchema.optional(),
    /** How it was identified; absent reads as `sdk` (data written before HTTP
     *  detection existed). */
    source: ExternalServiceSourceSchema.optional(),
    /** First few files that name it — evidence, capped so a report stays small. */
    evidence: z.array(ExternalServiceEvidenceSchema),
    /**
     * An env var that looks like a base-URL override for THIS service, when one is
     * visible. Telemetry for a later proxy/stub decision — never a behavior, and
     * absent is "not seen", never "does not exist" (see the detector's limits).
     *
     * BACK-COMPAT: the first (best-confidence) entry of {@link baseUrlEnvs}. Prefer
     * that field — a repo can override one service's base URL through SEVERAL
     * variables (one per upstream host), and this one can only name one of them.
     */
    baseUrlEnv: z.string().min(1).optional(),
    /**
     * EVERY base-URL override variable seen for this service, best-confidence
     * first: the structural `literal-fallback` bindings (each with the default URL
     * it falls back to) before the name-only guesses.
     */
    baseUrlEnvs: z.array(BaseUrlEnvSchema).optional(),
  })
  .strict()
export type DetectedExternalService = z.infer<typeof DetectedExternalServiceSchema>
