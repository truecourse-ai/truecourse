/**
 * PROMPT FINGERPRINTS, FROZEN AS LITERALS — every value a session or one-shot
 * cache key in this package folded before prompts left those keys.
 *
 * Each is used in exactly one place: the OLD key a changed cache reads on a
 * miss, computed from the CURRENT inputs with the fingerprint frozen here. A
 * legacy hit is re-saved under the new key, so no workspace pays to re-run a
 * stage whose inputs never moved.
 *
 * Delete this module with the legacy hash: once no old key is worth reading,
 * nothing folds a prompt at all.
 */

export const LEGACY_EXTRACT_SESSION_PROMPT_FINGERPRINT = 'fa764afd89cd5937'
export const LEGACY_FLOWS_SESSION_PROMPT_FINGERPRINT = '49a41e69b1cf1b28'
export const LEGACY_FLOWS_EPIC_SESSION_PROMPT_FINGERPRINT = '76421f444e5805e9'
export const LEGACY_FLOW_WORKER_CLI_PROMPT_FINGERPRINT = '15277774880ee40e'
export const LEGACY_FLOW_WORKER_API_PROMPT_FINGERPRINT = '1ef548ff71971375'
export const LEGACY_FLOW_WORKER_WEB_PROMPT_FINGERPRINT = 'e3062e1cd80be77a'
export const LEGACY_FIDELITY_SESSION_PROMPT_FINGERPRINT = 'e3ffbef6b5e1395c'
export const LEGACY_CURATE_DOC_PROMPT_FINGERPRINT = '1486af2b24899a6a'
export const LEGACY_SETTLE_AREAS_PROMPT_FINGERPRINT = 'd3dbf3f96843206a'
export const LEGACY_OVERLAP_SESSION_PROMPT_FINGERPRINT = '81b3bab8e6ea75a2'
export const LEGACY_RECONCILE_INTERFACES_PROMPT_FINGERPRINT = '4105196cc2a0b150'
export const LEGACY_SEED_SESSION_PROMPT_FINGERPRINT = '07bce17f3d575845'
export const LEGACY_DEPENDENCY_CATALOG_PROMPT_FINGERPRINT = 'c7f8f03b21202171'
export const LEGACY_ADJUDICATE_PROMPT_FINGERPRINT = '9928b4b88f39b70a'
export const LEGACY_VISUAL_JUDGE_PROMPT_FINGERPRINT = 'a4676e39e565e266'
