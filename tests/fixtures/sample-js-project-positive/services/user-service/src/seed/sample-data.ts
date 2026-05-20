/**
 * Seed/fixture helpers. The actual consumers are e2e specs and seed CLI
 * scripts, which are excluded from analysis by `**\/*.spec.*` /
 * `**\/*.test.*` patterns. The exports must not be flagged as unused.
 */

export function seedSampleAccount(slug: string): { slug: string } {
  return { slug };
}

export function unseedSampleAccount(slug: string): string {
  return slug;
}

export const SEED_SAMPLE_FACTS = {
  region: 'eu',
  retentionDays: 30,
};
