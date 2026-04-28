import { z } from 'zod'

// ---------------------------------------------------------------------------
// Declaration shape for rest-contract invariants
// ---------------------------------------------------------------------------
//
// Each invariant captures one structured claim extracted from a spec section,
// plus a code anchor identifying where the claim should hold. v1 covers three
// claim shapes; more can be added without a breaking schema change.
// ---------------------------------------------------------------------------

// Open string. The plugin extracts a wide range of REST contract obligations
// (status codes, request/response bodies, headers, query/path params, auth,
// pagination, idempotency, error envelope, versioning, field schemas, …) and
// the LLM tags each with a short kebab-case label. The label flows through to
// the violation title for display; nothing in the codebase switches on it, so
// new kinds can be introduced without a schema change.
export const ClaimKindSchema = z.string().min(1)
export type ClaimKind = z.infer<typeof ClaimKindSchema>

export const CodeAnchorSchema = z.object({
  /**
   * Path (relative to repo) of the file the claim targets. Optional — when
   * absent, enforcement falls back to the LLM locating the site by the
   * claim's prose.
   */
  filePath: z.string().optional(),
  /** Symbol within the file (route handler name, function, schema name). */
  symbol: z.string().optional(),
})
export type CodeAnchor = z.infer<typeof CodeAnchorSchema>

export const RestContractDeclarationSchema = z.object({
  kind: ClaimKindSchema,
  /** The structured claim, one-sentence form. */
  claim: z.string(),
  /**
   * Stable identifier for the obligation. Same role as `ruleKey` for static
   * rules: paraphrases of the same obligation collapse to one key, and tests
   * (or any external lookup) can match a violation back to a marker by this
   * string. Required.
   */
  obligationKey: z.string().min(1),
  /** Stable spec section id (`FILE:<path>#<heading-slug>` or external). */
  sourceSection: z.string(),
  codeAnchor: CodeAnchorSchema,
  /**
   * 'deterministic' | 'llm' — how enforcement compares code to claim.
   * v1 is LLM-only; deterministic shorthand is reserved for later.
   */
  enforcement: z.enum(['deterministic', 'llm']).default('llm'),
})
export type RestContractDeclaration = z.infer<typeof RestContractDeclarationSchema>
