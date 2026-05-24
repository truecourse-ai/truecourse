/**
 * Positive fixture for bugs/deterministic/prototype-pollution.
 *
 * Two FP shapes covered:
 *
 *   1. `const typedKey = key as keyof Foo` — the assignment uses an
 *      `as`-asserted alias of a for…in loop variable. The underlying
 *      iteration is over a typed object's own keys, not user input.
 *   2. `out[MIME_TYPE] = …` — the index is a module-level `const`
 *      initialised from a primitive string literal. Its value cannot become
 *      `"__proto__"` etc. unless the developer literally wrote that string.
 */

type FeatureFlags = { fast: boolean; safe: boolean; rich: boolean };

const ARCHIVE_MIME_TYPE = 'application/zip';

export function pickEnabledFlags(
  candidate: Partial<FeatureFlags>,
  baseline: Partial<FeatureFlags>,
): Record<keyof FeatureFlags, true> {
  const result: { [k in keyof FeatureFlags]?: true } = {};
  for (const key in candidate) {
    if (!Object.hasOwn(candidate, key)) continue;
    const typedKey = key as keyof FeatureFlags;
    if (candidate[typedKey] === true && baseline[typedKey] !== true) {
      result[typedKey] = true;
    }
  }
  return result as Record<keyof FeatureFlags, true>;
}

export function getArchiveAcceptDescriptor(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  out[ARCHIVE_MIME_TYPE] = ['.zip'];
  return out;
}
