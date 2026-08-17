/**
 * INTERFACE AUTHORING — the agent-loop stage that writes the half of the
 * interface catalog no derivation produces (AGENTIC_PIPELINE_PLAN §3.2, §10.4;
 * SPEC_GUARD_PLAN item 104).
 *
 * `mapInterfaces` derives the cli and api surfaces whole and the web surface's
 * PLACES; a web TASK is intent no tree states, so it is authored. This package
 * is that authoring as SESSIONS: one per place, on the shared loop, with
 * read-only tools over the repository and a validator the session iterates
 * against until its draft is one the write path accepts.
 *
 * Driver-agnostic and store-agnostic by construction — the session driver and
 * the transcript persistence are injected by the caller (`@truecourse/core`).
 */
export {
  AUTHORED_SURFACE,
  AuthoredFragmentSchema,
  AuthoredPlaceSchema,
  AuthoredTaskSchema,
  candidateAuthored,
  stampFragment,
  validateFragment,
  type AuthoredFragment,
  type AuthoredPlace,
  type AuthoredTask,
  type FragmentValidation,
  type ValidateFragmentInput,
} from './draft.js'
export { buildAuthorTools, type AuthorToolsInput } from './tools.js'
export {
  INTERFACE_AUTHOR_BUDGET,
  INTERFACE_AUTHOR_SESSION_KIND,
  interfaceAuthorSessionDef,
  placeBriefing,
  placeWorkItem,
  type AuthorSessionInput,
} from './session.js'
export {
  authorWebInterfaces,
  planWorkItems,
  type AuthorProgress,
  type AuthorRunOptions,
  type AuthorRunResult,
  type AuthorWorkItem,
  type PlaceResult,
} from './author.js'
export { writeAuthoredCatalog, type WriteAuthoredInput } from './write.js'
