import { eq, notInArray } from 'drizzle-orm';
import { db } from '../config/database.js';
import { rules } from '../db/schema.js';
import { getAllDefaultRules } from '@truecourse/analyzer';
import type { AnalysisRule } from '@truecourse/shared';

/**
 * Seed default rules into the database.
 * Uses upsert — new rules are inserted, existing rules get their
 * name/description/prompt/severity updated (preserving user's `enabled` toggle).
 * Removes rules that are no longer in the defaults.
 */
export async function seedRules(): Promise<void> {
  const defaults = getAllDefaultRules();

  for (const rule of defaults) {
    await db
      .insert(rules)
      .values({
        key: rule.key,
        category: rule.category,
        name: rule.name,
        description: rule.description,
        prompt: rule.prompt ?? null,
        enabled: rule.enabled,
        severity: rule.severity,
        type: rule.type,
        isDependencyViolation: rule.isDependencyViolation ?? false,
      })
      .onConflictDoUpdate({
        target: rules.key,
        set: {
          category: rule.category,
          name: rule.name,
          description: rule.description,
          prompt: rule.prompt ?? null,
          severity: rule.severity,
          type: rule.type,
          isDependencyViolation: rule.isDependencyViolation ?? false,
          updatedAt: new Date(),
        },
      });
  }

  // Remove rules that are no longer in the defaults
  const defaultKeys = defaults.map((r) => r.key);
  const deleted = await db.delete(rules).where(notInArray(rules.key, defaultKeys)).returning({ key: rules.key });
  if (deleted.length > 0) {
    console.log(`[Rules] Removed ${deleted.length} obsolete rule(s): ${deleted.map((r) => r.key).join(', ')}`);
  }
}

/**
 * Get all rules from the database.
 */
export async function getRulesFromDb(): Promise<AnalysisRule[]> {
  const rows = await db.select().from(rules);
  return rows.map((r) => ({
    key: r.key,
    category: r.category as AnalysisRule['category'],
    name: r.name,
    description: r.description,
    prompt: r.prompt ?? undefined,
    enabled: r.enabled,
    severity: r.severity as AnalysisRule['severity'],
    type: r.type as AnalysisRule['type'],
  }));
}

/**
 * Get enabled rules from the database.
 */
export async function getEnabledRules(): Promise<AnalysisRule[]> {
  const rows = await db.select().from(rules).where(eq(rules.enabled, true));
  return rows.map((r) => ({
    key: r.key,
    category: r.category as AnalysisRule['category'],
    name: r.name,
    description: r.description,
    prompt: r.prompt ?? undefined,
    enabled: r.enabled,
    severity: r.severity as AnalysisRule['severity'],
    type: r.type as AnalysisRule['type'],
  }));
}
