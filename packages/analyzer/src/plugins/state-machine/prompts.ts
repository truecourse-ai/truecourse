import type { SpecSection } from '../types.js'

// ---------------------------------------------------------------------------
// Discovery prompt — sanity-filter + state/transition extraction in one call
// ---------------------------------------------------------------------------
//
// The plugin extracts the candidate (union type + observed transition graph
// from code) deterministically, then asks the LLM ONE question per
// candidate:
//
//   "Is this a real state machine? If yes, give me the canonical states /
//    terminal states / initial states / legal transitions, drawing on any
//    spec text I'm including. If it's just an ad-hoc enum (roles, tiers,
//    categories), say so and we drop it."
//
// The observed graph is the LLM's grounding signal: states the code never
// transitions out of are terminal candidates; states that only ever appear
// as `to` are initial candidates. The LLM may extend or override based on
// the spec.
// ---------------------------------------------------------------------------

export interface DiscoveryPromptInput {
  /** Qualified scope label, e.g. `Step.status`. */
  scope: string
  /** Closed set of state values from the union type declaration. */
  states: string[]
  /** Observed transitions inferred from guarded writes — one row per `(prior, new)`. */
  observedTransitions: Array<{ from: string; to: string }>
  /**
   * States that have at least one unguarded assignment write — surfacing
   * these helps the LLM reason about which states are reachable but may
   * not have been observed as priors of guarded writes.
   */
  observedUnguardedTargets: string[]
  /**
   * States only ever seen as the value of an object-literal initial write
   * (e.g. `new T({ status: 'pending' })`) — strong signal for the
   * `initial` set.
   */
  observedInitialTargets: string[]
  /** Spec sections that mention any of the state values, for cross-reference. */
  relevantSpecSections: SpecSection[]
}

export function buildDiscoveryPrompt(input: DiscoveryPromptInput): string {
  const transitionLines = input.observedTransitions.length === 0
    ? '(none — no guarded writes observed)'
    : input.observedTransitions.map((t) => `  • ${t.from} → ${t.to}`).join('\n')

  const unguardedLine = input.observedUnguardedTargets.length === 0
    ? '(none)'
    : input.observedUnguardedTargets.join(', ')

  const initialLine = input.observedInitialTargets.length === 0
    ? '(none)'
    : input.observedInitialTargets.join(', ')

  const specBlock = input.relevantSpecSections.length === 0
    ? '(no relevant spec sections found)'
    : input.relevantSpecSections
        .map((s) => `## ${s.heading}  (${s.sourcePath})\n${s.content}`)
        .join('\n\n---\n\n')

  return `You are reviewing a candidate state machine extracted from a project's code.

# Candidate
Scope: ${input.scope}
Declared state values: ${input.states.map((s) => `\`${s}\``).join(', ')}

# Observed in code
Guarded transitions (write was inside an \`if (x.${input.scope.split('.')[1]} === 'literal')\`):
${transitionLines}

States with unguarded writes (the write may run from any prior state):
${unguardedLine}

States seen as initial-write values (object literal in \`new T(...)\` or \`return {...}\`):
${initialLine}

# Spec context
${specBlock}

# Task
Decide whether this is a **real state machine** (a value with a meaningful lifecycle and constrained transitions) or an **ad-hoc enum** (categories, roles, tiers, modes — values that don't represent stages of a process).

If ad-hoc enum:
- Return \`{ "isStateMachine": false, "reason": "<one sentence>" }\`. Done.

If real state machine:
- Return \`{ "isStateMachine": true, "states": [...], "terminal": [...], "initial": [...], "transitions": [{ "from": ..., "to": ... }, ...], "confidence": 0..1, "rationale": "<one sentence>" }\`.

Rules for the state machine output:
- **states** — must equal the candidate's declared state values exactly. Don't add or remove members.
- **terminal** — subset of \`states\`. A terminal state has no outgoing transitions. Use the spec if it names them (e.g. "succeeded and failed are final"); otherwise default to states with no observed outgoing transitions in the code.
- **initial** — subset of \`states\` allowed at construction. Default to the observed initial-write targets; extend if the spec names additional creation paths.
- **transitions** — the union of (a) the observed guarded transitions above, (b) any additional transitions the spec explicitly authorizes. Do NOT invent transitions that are neither observed nor spec-authorized.
- **confidence** — your confidence this is a real state machine (not whether the transitions are exhaustive). 0.5 if borderline; below 0.5 we prefer to skip.
- **rationale** — one sentence on why this is (or isn't) a state machine.

Return strict JSON matching the schema. No prose outside the JSON object.
`
}
