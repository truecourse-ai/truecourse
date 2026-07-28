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
 * Detection is import-based and therefore a claim about DECLARED dependencies, not
 * about egress at run time: a service imported but never called still appears.
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

/** Where a service was seen: the file, and the import specifier that named it. */
export const ExternalServiceEvidenceSchema = z
  .object({
    filePath: z.string().min(1),
    importSource: z.string().min(1),
  })
  .strict()
export type ExternalServiceEvidence = z.infer<typeof ExternalServiceEvidenceSchema>

/**
 * One detected third party. `service` is the CANONICAL registry name (`stripe`,
 * `aws-sqs`) — the identity that gets stamped into a blocked-on gap reason and
 * tallied per service, so it must be stable across runs and repos.
 */
export const DetectedExternalServiceSchema = z
  .object({
    service: z.string().min(1),
    category: ExternalServiceCategorySchema,
    /** First few files that import it — evidence, capped so a report stays small. */
    evidence: z.array(ExternalServiceEvidenceSchema),
    /**
     * An env var that looks like a base-URL override for THIS service (a name
     * carrying the service token and one of URL/BASE/HOST/ENDPOINT/URI), when one
     * is visible. Telemetry for a later proxy/stub decision — never a behavior, and
     * absent is "not seen", never "does not exist" (see the detector's limits).
     */
    baseUrlEnv: z.string().min(1).optional(),
  })
  .strict()
export type DetectedExternalService = z.infer<typeof DetectedExternalServiceSchema>
