
declare type FeatureFlags = { betaAccess?: true; advancedEditor?: true; apiAccess?: true };

function mergeNewFlags(
  existing: Partial<FeatureFlags>,
  incoming: Partial<FeatureFlags>
): Record<keyof FeatureFlags, true> {
  const flags: { [key in keyof FeatureFlags]?: true } = {};

  for (const key in incoming) {
    const typedKey = key as keyof FeatureFlags;
    if (incoming[typedKey] === true && existing[typedKey] !== true) {
      flags[typedKey] = true;
    }
  }

  return flags as Record<keyof FeatureFlags, true>;
}
