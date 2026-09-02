/**
 * `guard setup`'s agent sessions — the seams the command adapter injects into
 * `@truecourse/guard-generator`'s `runGuardSetup`:
 *
 *  - recipe repair (`guard-setup.recipe-repair`) — loop only on the failure
 *    path of recipe discovery;
 *  - dependency catalog (`guard-setup.dependency-catalog`) — classify/condition
 *    the catalog after the deterministic skeleton;
 *  - the interfaces step (`interfaces-step.ts`) — the
 *    `guard-setup.reconcile-interfaces` session over the cli union's disputes
 *    (`reconcile-interfaces.ts`), then the web-task authoring run;
 *  - the seed session (`guard-setup.seed`) — prove-by-execution seed authoring
 *    against the live services;
 *  - the auth proof (`guard-setup.auth-proof`) — supplied-state verification;
 *    proof-class, never cached.
 */

export {
  createGuardSetupSessionContext,
  describeSessionFailure,
  type GuardSetupSessionContext,
  type GuardSetupSessionContextOptions,
} from './session-context.js';
export {
  RECIPE_REPAIR_SESSION_KIND,
  RECIPE_REPAIR_BUDGET,
  buildRecipeRepair,
  recipeRepairSessionDef,
  recipeRepairBriefing,
  type RecipeRepairSessionInput,
  type BuildRecipeRepairOptions,
} from './recipe-repair.js';
export {
  DEPENDENCY_CATALOG_SESSION_KIND,
  DEPENDENCY_CATALOG_CACHE_NAME,
  DEPENDENCY_CATALOG_BUDGET,
  CatalogDraftSchema,
  buildCatalogSession,
  dependencyCatalogSessionDef,
  dependencyCatalogBriefing,
  parseCatalogCondition,
  validateCatalogDraft,
  foldCatalogDraft,
  type CatalogDraft,
  type CatalogFoldResult,
  type BuildCatalogSessionOptions,
} from './dependency-catalog.js';
export {
  RECONCILE_INTERFACES_SESSION_KIND,
  RECONCILE_INTERFACES_BUDGET,
  applyReconcileResolutions,
  runReconcileInterfacesSession,
  validateResolutions,
  type InterfaceResolution,
} from './reconcile-interfaces.js';
export {
  buildInterfacesStep,
  type BuildInterfacesStepOptions,
  type InterfacesAuthorFn,
  type InterfacesAuthorRun,
} from './interfaces-step.js';
export {
  SEED_SESSION_KIND,
  SEED_SESSION_BUDGET,
  SeedSessionOutcomeSchema,
  buildSeedSession,
  seedSessionBriefing,
  seedSessionCacheKey,
  seedScriptTargetPath,
  providesWarnings,
  type SeedSessionOutcome,
  type BuildSeedSessionOptions,
} from './seed-session.js';
export {
  AUTH_PROOF_SESSION_KIND,
  AUTH_PROOF_BUDGET,
  AuthProofOutcomeSchema,
  buildAuthProof,
  type AuthProofOutcome,
  type BuildAuthProofOptions,
} from './auth-proof.js';
