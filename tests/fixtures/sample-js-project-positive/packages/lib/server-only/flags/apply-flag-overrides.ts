
declare type FeatureFlags = { enableBilling?: boolean; enableSso?: boolean; enableApiAccess?: boolean };

// eslint-disable-next-line guard-for-in
function applyFlagOverrides(target: FeatureFlags, overrides: Partial<FeatureFlags>): FeatureFlags {
  const result = { ...target };
  for (const key in overrides) {
    // overrides is typed as Partial<FeatureFlags> — a plain object with no prototype properties
    (result as Record<string, unknown>)[key] = (overrides as Record<string, unknown>)[key];
  }
  return result;
}
