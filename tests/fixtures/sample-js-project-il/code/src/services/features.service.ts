import { readFileSync } from 'node:fs';

/**
 * Feature-flag registry. Flag values are sourced from
 * config/features.json and surfaced to the rest of the app here.
 */
// Spec forbids FEATURE_EXPORT_V2 from any shipped config — the data-export
// feature is GA, so the flag must be removed. It still ships in
// config/features.json.
// IL-DRIFT: ForbiddenArtifact:feature-experimental-export / forbidden.feature-flag.FEATURE_EXPORT_V2.present
export function loadFlags(): Record<string, boolean> {
  const raw = readFileSync(new URL('../../config/features.json', import.meta.url), 'utf-8');
  return JSON.parse(raw) as Record<string, boolean>;
}
