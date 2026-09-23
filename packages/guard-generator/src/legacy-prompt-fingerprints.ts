/**
 * PROMPT FINGERPRINTS, FROZEN AS LITERALS — every value this package's keys
 * folded before prompts left them.
 *
 * Two jobs, both temporary:
 *
 * - the legacy flow settle hash ({@link legacyFlowGenerationInputsHash}) is the
 *   one check a manifest row written before named components gets, and it must
 *   compute what the writer computed, so a prompt edited since then cannot make
 *   it miss;
 * - every cache whose key formula changed reads its OLD key on a miss, computed
 *   from the current inputs with the fingerprint frozen here.
 *
 * Delete this module with the legacy hash: once no stored manifest lacks
 * components and no old key is worth reading, nothing folds a prompt at all.
 */

/** The retired one-shot extract / flows / epic prompts, frozen at the session cut-over. */
export const LEGACY_RETIRED_EXTRACT_PROMPT_FINGERPRINT = '87fe2fdd9881b428'
export const LEGACY_RETIRED_FLOWS_PROMPT_FINGERPRINT = '654d47c7386fcd58'
export const LEGACY_RETIRED_FLOWS_EPIC_PROMPT_FINGERPRINT = 'fa167e39be3b4a5b'

/** The five live one-shot prompts the flow settle hash folded. */
export const LEGACY_MATCH_PROMPT_FINGERPRINT = '7d11763dc27a1073'
export const LEGACY_GENERATE_PROMPT_FINGERPRINT = 'dbd51b305804446f'
export const LEGACY_GENERATE_API_PROMPT_FINGERPRINT = '19bc81600d20c80e'
export const LEGACY_GENERATE_WEB_PROMPT_FINGERPRINT = '6774e7b1b310fa4b'
export const LEGACY_FIDELITY_PROMPT_FINGERPRINT = '138c88a43c2cb131'

/** The one-shot prompts this package's own stage caches keyed on. */
export const LEGACY_RECIPE_PROMPT_FINGERPRINT = 'd6802b6c3c74be5d'
export const LEGACY_CLAIM_DIFF_PROMPT_FINGERPRINT = '582e0899c8bac247'
export const LEGACY_WORLD_CLASSIFY_PROMPT_FINGERPRINT = '4057865fb913bdb8'
