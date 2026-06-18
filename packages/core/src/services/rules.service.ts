import { getAllDefaultRules } from '@truecourse/analyzer';
import { type AnalysisRule, DOMAIN_ORDER } from '@truecourse/shared';
import { readProjectConfig } from '../config/project-config.js';

/** Derive domain from rule key (e.g., 'architecture/deterministic/foo' → 'architecture'). */
function deriveDomain(key: string): AnalysisRule['domain'] {
  const firstSlash = key.indexOf('/');
  if (firstSlash === -1) return undefined;
  const prefix = key.slice(0, firstSlash);
  const validDomains = new Set<string>(DOMAIN_ORDER);
  return validDomains.has(prefix) ? (prefix as AnalysisRule['domain']) : undefined;
}

function toAnalysisRule(
  rule: ReturnType<typeof getAllDefaultRules>[number],
  enabled: boolean = rule.enabled,
): AnalysisRule {
  return {
    key: rule.key,
    category: rule.category,
    domain: deriveDomain(rule.key),
    name: rule.name,
    description: rule.description,
    prompt: rule.prompt ?? undefined,
    enabled,
    severity: rule.severity,
    type: rule.type,
    contextRequirement: rule.contextRequirement,
    languageSupport: rule.languageSupport,
  };
}

/**
 * Return the full rule catalogue. When `repoPath` is provided, the `enabled`
 * flag reflects per-repo overrides from `<repo>/.truecourse/config.json`
 * (`disabledRules`). Without `repoPath`, every shipped rule is enabled.
 */
export async function getRules(repoPath?: string): Promise<AnalysisRule[]> {
  const disabled = repoPath
    ? new Set<string>(readProjectConfig(repoPath).disabledRules ?? [])
    : null;
  return getAllDefaultRules().map((r) =>
    toAnalysisRule(r, disabled ? r.enabled && !disabled.has(r.key) : r.enabled),
  );
}

/** Return the subset of rules with `enabled: true`. */
export async function getEnabledRules(): Promise<AnalysisRule[]> {
  return getAllDefaultRules()
    .filter((r) => r.enabled)
    .map((r) => toAnalysisRule(r));
}
