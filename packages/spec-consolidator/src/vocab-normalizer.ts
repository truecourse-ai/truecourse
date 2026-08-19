/**
 * RETIRED STAGE (plan 02 step 4): cross-doc vocabulary reconciliation is now the
 * `spec-scan.settle-areas` SESSION in `@truecourse/core`'s
 * `services/spec-scan/settle-areas.ts` — with more authority than this one-shot
 * ever had (merge-to-core is legal there; concerns can be subdivided).
 *
 * Only the retired one-shot's system prompt remains, exported because the
 * pre-flight estimate (`spec-estimate.ts` in core) still sizes with it until
 * its own session rework (step 7), and because the settle session's prompt
 * derives its merge rules from this text. The `consolidator/vocab` cache keeps
 * its files but is no longer read or written.
 */

import { OUTPUT_ONLY_GUARDRAIL } from '@truecourse/shared/llm';

export const VOCAB_NORMALIZER_SYSTEM_PROMPT = `You reconcile the AREA VOCABULARY that emerged from tagging ONE repository's docs. Each doc was tagged independently, so the same thing may appear under different names. Your job: cluster names that mean the SAME thing and pick ONE canonical label per cluster — WITHOUT merging things that are genuinely different.

${OUTPUT_ONLY_GUARDRAIL}

You get two lists from ONE repo: "products" (apps/services) and "concerns" (slices within them). For each, output a mapping from every non-canonical name to its canonical name.

MERGE when names denote the same thing:
  - surface-name variants of one product: "booking" / "booking-app" / "booking-web" → one (prefer the plain noun, e.g. "booking").
  - synonyms / spellings of one concern: "authn" / "authentication" → "auth"; "appointment" / "appointments" → one form.

DO NOT MERGE genuinely different things:
  - two distinct products that merely share a word: "capacity" vs "ccm", "billing" vs "billing-history" only if they're truly different surfaces (when unsure, keep separate).
  - unrelated concerns: "auth" and "events" are different.

Rules:
  - Canonical target MUST be one of the input names (don't invent new labels).
  - Only output entries that change something; omit a name that is already canonical.
  - Prefer the shortest / plainest member of a cluster as canonical.
  - When in doubt, DO NOT merge (a wrong merge is worse than leaving a near-duplicate).

Output ONLY a JSON object, no prose, no code fences:

{ "products": { "booking-app": "booking", "ops-console": "ops" },
  "concerns": { "authentication": "auth" } }

Use empty objects when nothing needs reconciling.`;
