import { getAllDefaultRules } from '@truecourse/analyzer';
import { type AnalysisRule, DOMAIN_ORDER } from '@truecourse/shared';

/** Derive domain from rule key (e.g., 'architecture/deterministic/foo' → 'architecture'). */
function deriveDomain(key: string): AnalysisRule['domain'] {
  const firstSlash = key.indexOf('/');
  if (firstSlash === -1) return undefined;
  const prefix = key.slice(0, firstSlash);
  const validDomains = new Set<string>(DOMAIN_ORDER);
  return validDomains.has(prefix) ? (prefix as AnalysisRule['domain']) : undefined;
}

function toAnalysisRule(rule: ReturnType<typeof getAllDefaultRules>[number]): AnalysisRule {
  return {
    key: rule.key,
    category: rule.category,
    domain: deriveDomain(rule.key),
    name: rule.name,
    description: rule.description,
    prompt: rule.prompt ?? undefined,
    enabled: rule.enabled,
    severity: rule.severity,
    type: rule.type,
    contextRequirement: rule.contextRequirement,
  };
}

/**
 * Return the full rule catalogue. Rules are now TypeScript constants in the
 * analyzer package — no DB persistence, no seed step. Per-repo on/off
 * preferences will be overlaid via `<repo>/.truecourse/config.json` when
 * that feature lands; for now every shipped rule is enabled.
 */
export async function getRules(): Promise<AnalysisRule[]> {
  return getAllDefaultRules().map(toAnalysisRule);
}

/** Return the subset of rules with `enabled: true`. */
export async function getEnabledRules(): Promise<AnalysisRule[]> {
  return getAllDefaultRules()
    .filter((r) => r.enabled)
    .map(toAnalysisRule);
}
