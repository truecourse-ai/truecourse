import { z } from 'zod'

// ---------------------------------------------------------------------------
// ADR status
// ---------------------------------------------------------------------------
//
// MADR status values we support on disk:
//   `proposed`   — draft ratified by user (or authored via 19.5) but not finalized
//   `accepted`   — the standard state for a ratified decision (default on accept)
//   `deprecated` — no longer in force (user sets manually)
//   `superseded` — replaced by a newer ADR (via `supersedes` chain)
//
// `stale` is a computed overlay set by the staleness check — never written to
// the MADR file on disk, only present on the parsed corpus record.

export const AdrStatusSchema = z.enum([
  'proposed',
  'accepted',
  'deprecated',
  'superseded',
  'stale',
])
export type AdrStatus = z.infer<typeof AdrStatusSchema>

// ---------------------------------------------------------------------------
// Topic vocabulary
// ---------------------------------------------------------------------------
//
// The fixed set of topic categories an ADR draft can be about. The LLM picks
// one per draft — no free-form topic strings — so signatures stay stable
// across runs (rewordings of "circular dep" / "cycle" / "circular dependency"
// all resolve to `circular-dependency`).
//
// Adding a topic here is a deliberate decision: it expands the space of
// signatures the `suggest` LLM can produce, which affects dedupe behavior on
// repos that have already rejected drafts under the old vocab.

export const ADR_TOPIC_VOCAB = [
  'circular-dependency',
  'shared-database',
  'facade-module',
  'service-boundary',
  'auth-placement',
  'caching-strategy',
  'communication-pattern',
] as const

export type AdrTopicValue = (typeof ADR_TOPIC_VOCAB)[number]

export const AdrTopicSchema = z.enum(ADR_TOPIC_VOCAB)
export type AdrTopic = z.infer<typeof AdrTopicSchema>

// ---------------------------------------------------------------------------
// Topic signature — dedupe fingerprint for rejected drafts
// ---------------------------------------------------------------------------
//
// Shape: { topic, entities }. Entities MUST be sorted — the signature is
// compared by structural equality, so callers construct this via
// `computeSignature(...)` (M2), never by hand.

export const TopicSignatureSchema = z.object({
  topic: AdrTopicSchema,
  entities: z.array(z.string()),
})
export type TopicSignature = z.infer<typeof TopicSignatureSchema>

// ---------------------------------------------------------------------------
// MADR sections — the structured body
// ---------------------------------------------------------------------------

export const AdrSectionsSchema = z.object({
  context: z.string(),
  decision: z.string(),
  consequences: z.string(),
})
export type AdrSections = z.infer<typeof AdrSectionsSchema>

// ---------------------------------------------------------------------------
// Accepted ADR — parsed from `docs/adr/ADR-NNNN-slug.md`
// ---------------------------------------------------------------------------
//
// `number` is the arithmetic form (used to compute the next draft's number).
// `id` is the display form — always `ADR-<4-digit-padded>`.
// `linkedNodeIds` starts identical to the LLM's entity manifest on accept,
// and is mutated thereafter only via `adr link` / `adr unlink`.
// `requiredEntities` is the snapshot of entities this ADR depends on for
// staleness checks — defaults to a copy of `linkedNodeIds` on accept, but
// can diverge if links are added/removed after the fact.
// `isStale` and `staleReasons` are transient overlays — never persisted
// into the MADR file, only into the parsed corpus record.

// ---------------------------------------------------------------------------
// Living Fragments (Phase 19.1 M11)
// ---------------------------------------------------------------------------
//
// Structured fenced blocks inside a MADR body that render live in the
// dashboard:
//
//   ```adr-graph
//   services: [auth-service, billing-service]
//   show: dependencies
//   ```
//
//   ```adr-flow
//   flowId: user-registration
//   ```
//
// At accept time, each fragment is resolved against the current graph and a
// compact `FragmentSnapshot` is captured alongside the index entry. The
// dashboard renders both the decision-time snapshot and the live graph view,
// highlighting drift. Fragment references that disappear from the graph
// flag the ADR as stale (extension of structural staleness).

export const AdrGraphFragmentLocatorSchema = z.object({
  services: z.array(z.string()).optional(),
  modules: z.array(z.string()).optional(),
  show: z.enum(['dependencies', 'modules', 'all']).optional(),
})
export type AdrGraphFragmentLocator = z.infer<typeof AdrGraphFragmentLocatorSchema>

export const AdrFlowFragmentLocatorSchema = z.object({
  flowId: z.string(),
  fromStep: z.number().int().optional(),
  toStep: z.number().int().optional(),
})
export type AdrFlowFragmentLocator = z.infer<typeof AdrFlowFragmentLocatorSchema>

export const GraphFragmentNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['service', 'module', 'database']),
  // Rich fields carried so the dashboard ADR renderer shows the same
  // node treatment as the main Graph tab (framework, layer badges, file
  // count, DB icon). All optional — older snapshots stay valid.
  description: z.string().nullish(),
  // service only
  serviceType: z.string().optional(),
  framework: z.string().nullish(),
  fileCount: z.number().int().optional(),
  layers: z.array(z.string()).optional(),
  rootPath: z.string().optional(),
  // database only
  databaseType: z.string().optional(),
  tableCount: z.number().int().optional(),
  connectedServices: z.array(z.string()).optional(),
  // module only
  moduleKind: z.string().optional(),
  methodCount: z.number().int().optional(),
})
export type GraphFragmentNode = z.infer<typeof GraphFragmentNodeSchema>

export const GraphFragmentEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  count: z.number().int().optional(),
  // 'http' | 'import' | 'database' — mirrors the main graph's
  // `edge.data.dependencyType`. Client uses it to pick stroke color,
  // dash pattern, and label ("4 HTTP calls" etc).
  dependencyType: z.string().optional(),
})
export type GraphFragmentEdge = z.infer<typeof GraphFragmentEdgeSchema>

export const FlowFragmentStepSchema = z.object({
  stepOrder: z.number().int(),
  sourceService: z.string(),
  /** Optional so older snapshots (service-only) stay valid. New captures
   *  include it so the ADR render matches the main Flows tab's module
   *  granularity. */
  sourceModule: z.string().optional(),
  targetService: z.string(),
  targetModule: z.string().optional(),
  targetMethod: z.string().optional(),
  stepType: z.string(),
  isAsync: z.boolean().optional(),
  dataDescription: z.string().nullish(),
})
export type FlowFragmentStep = z.infer<typeof FlowFragmentStepSchema>

export const FragmentSnapshotSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('graph'),
    locator: AdrGraphFragmentLocatorSchema,
    capturedAt: z.string(),
    nodes: z.array(GraphFragmentNodeSchema),
    edges: z.array(GraphFragmentEdgeSchema),
    graphHash: z.string(),
  }),
  z.object({
    kind: z.literal('flow'),
    locator: AdrFlowFragmentLocatorSchema,
    capturedAt: z.string(),
    flowName: z.string(),
    steps: z.array(FlowFragmentStepSchema),
    graphHash: z.string(),
  }),
])
export type FragmentSnapshot = z.infer<typeof FragmentSnapshotSchema>

// ---------------------------------------------------------------------------
// Index entry + full runtime form
// ---------------------------------------------------------------------------

export const AdrIndexEntrySchema = z.object({
  id: z.string().regex(/^ADR-\d{4,}$/),
  number: z.number().int().positive(),
  title: z.string(),
  status: AdrStatusSchema,
  date: z.string(),
  path: z.string(),
  deciders: z.array(z.string()).optional(),
  linkedNodeIds: z.array(z.string()),
  supersedes: z.array(z.string()).optional(),
  supersededBy: z.string().optional(),
  requiredEntities: z.array(z.string()),
  isStale: z.boolean().optional(),
  staleReasons: z.array(z.string()).optional(),
  sourceDraftId: z.string().optional(),
  /** Captured at accept time from `adr-graph` / `adr-flow` blocks in the
   *  MADR body. Rendered live in the dashboard with drift highlighting. */
  fragments: z.array(FragmentSnapshotSchema).optional(),
})

/**
 * Metadata-only record — what's persisted in `.truecourse/adrs.json`. The
 * MADR sections themselves live only in `docs/adr/ADR-NNNN-<slug>.md` (the
 * source of truth) and are loaded on demand. Keeps the JSON index free of
 * escaped-markdown body strings.
 */
export type AdrIndexEntry = z.infer<typeof AdrIndexEntrySchema>

export const AdrSchema = AdrIndexEntrySchema.extend({
  sections: AdrSectionsSchema,
})

/**
 * Full runtime ADR — index entry plus the parsed body sections. Returned by
 * `loadAdrById` and detail-level endpoints; never persisted wholesale into
 * the index.
 */
export type Adr = z.infer<typeof AdrSchema>

// ---------------------------------------------------------------------------
// Draft — pending review queue entry under `.truecourse/drafts/`
// ---------------------------------------------------------------------------
//
// One file per draft, filename = `<draftId>.json`. Lives here until the user
// Accepts (promoted to `docs/adr/ADR-NNNN-slug.md` and this file deleted) or
// Rejects (topic signature persisted to `adr-rejected.json` and this file
// deleted).
//
// `confidence` is the LLM's self-reported confidence that this topic is a
// genuinely non-obvious architectural decision worth documenting. Used by
// the `--threshold` filter — NOT a link-level confidence score.

export const AdrDraftSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  title: z.string(),
  topic: AdrTopicSchema,
  entities: z.array(z.string()),
  madrBody: z.string(),
  confidence: z.number().min(0).max(1),
})
export type AdrDraft = z.infer<typeof AdrDraftSchema>
