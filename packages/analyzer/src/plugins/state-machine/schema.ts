import { z } from 'zod'

// ---------------------------------------------------------------------------
// Declaration shape for state-machine invariants
// ---------------------------------------------------------------------------
//
// A state-machine invariant declares the legal transitions for one field
// across the codebase. Enforcement walks every write site of the field,
// infers the possible prior states from surrounding guards, and flags any
// (prior, new) pair not present in `transitions`. Initial writes (object
// literals in `new X({...})` or `return {...}`) check against `initial`.
//
// Scope binding is a `<TypeName>.<field>` pair where `TypeName` is the
// owning class/interface and `field` is the property typed by the union.
// v1 supports string-literal union types; future versions can extend the
// schema with enum/zod-enum sources without breaking change since the
// declaration shape is source-agnostic.
// ---------------------------------------------------------------------------

const StateName = z.string().min(1)

/**
 * One declared transition. `from` and `to` accept either a single state or
 * a list — the list form is sugar for `from.length × to.length` rows. The
 * plugin expands fan-outs internally so enforcement compares against a
 * flat `(prior, new)` set.
 */
export const TransitionSchema = z.object({
  from: z.union([StateName, z.array(StateName).min(1)]),
  to: z.union([StateName, z.array(StateName).min(1)]),
})
export type Transition = z.infer<typeof TransitionSchema>

export const StateMachineDeclarationSchema = z.object({
  /**
   * Qualified field, e.g. `Step.status`. The plugin resolves this to the
   * owning type's `field` declaration to find write sites.
   */
  scope: z.string().min(1).regex(/^[A-Za-z_][\w]*\.[A-Za-z_][\w]*$/, {
    message: 'scope must be of the form `TypeName.fieldName`',
  }),
  /**
   * Stable identifier for the obligation. Same role as `obligationKey` on
   * rest-contract: framework-level marker tests + diff tooling can match
   * a violation back to its invariant by exact-string comparison. v1
   * uses `scope` verbatim — one obligation per state machine — so
   * `obligationKey === scope` for all discovered drafts. Hand-authored
   * invariants must set it (the plugin emits it deterministically).
   */
  obligationKey: z.string().min(1),
  /** Closed set of legal state values. Used to validate `from`/`to` membership. */
  states: z.array(StateName).min(2),
  /** Subset of `states` with no outgoing transitions. May be empty. */
  terminal: z.array(StateName).default([]),
  /** States allowed at construction-time / initial writes. Must be non-empty. */
  initial: z.array(StateName).min(1),
  /** Legal transitions. Fan-outs (`from: [a, b], to: [c, d]`) are expanded by the plugin. */
  transitions: z.array(TransitionSchema),
})
export type StateMachineDeclaration = z.infer<typeof StateMachineDeclarationSchema>

// ---------------------------------------------------------------------------
// Helpers — flatten fan-outs into an exact `(prior, new)` set
// ---------------------------------------------------------------------------

function asArray(v: string | string[]): string[] {
  return Array.isArray(v) ? v : [v]
}

/**
 * Expand `transitions` into the set of legal `(from, to)` pairs as
 * `${from}|${to}` keys. Enforcement does `set.has(\`${prior}|${new}\`)`.
 */
export function buildTransitionSet(decl: StateMachineDeclaration): Set<string> {
  const out = new Set<string>()
  for (const t of decl.transitions) {
    for (const f of asArray(t.from)) {
      for (const to of asArray(t.to)) {
        out.add(`${f}|${to}`)
      }
    }
  }
  return out
}
