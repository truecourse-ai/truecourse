import * as p from "@clack/prompts";
import { DOMAIN_ORDER } from "@truecourse/shared";
import {
  readProjectConfig,
  updateProjectConfig,
} from "@truecourse/core/config/project-config";
import { getRules } from "@truecourse/core/services/rules";
import { requireRegisteredRepo } from "./helpers.js";

const ALL_CATEGORIES = [...DOMAIN_ORDER] as string[];

export interface RulesCategoriesOptions {
  enable?: string;
  disable?: string;
  reset?: boolean;
}

export async function runRulesCategories(options: RulesCategoriesOptions): Promise<void> {
  const repo = await requireRegisteredRepo();

  if (options.reset) {
    await updateProjectConfig(repo.path, { enabledCategories: null });
    p.log.success("Reset to global default categories.");
    return;
  }

  if (options.enable || options.disable) {
    const cat = options.enable ?? options.disable!;
    if (!ALL_CATEGORIES.includes(cat)) {
      p.log.error(`Invalid category: ${cat}. Valid: ${ALL_CATEGORIES.join(", ")}`);
      process.exit(1);
    }

    const config = await readProjectConfig(repo.path);
    const hasOverride = config.enabledCategories != null;
    const current = new Set<string>(hasOverride ? config.enabledCategories! : ALL_CATEGORIES);

    if (options.enable) current.add(cat);
    else current.delete(cat);

    await updateProjectConfig(repo.path, { enabledCategories: [...current] });
    p.log.success(`${options.enable ? "Enabled" : "Disabled"} ${cat} rules for ${repo.name}.`);
    return;
  }

  const config = await readProjectConfig(repo.path);
  const isOverride = config.enabledCategories != null;
  const enabled = new Set<string>(isOverride ? config.enabledCategories! : ALL_CATEGORIES);

  const status = (cat: string) =>
    enabled.has(cat) ? "\x1b[32menabled\x1b[0m" : "\x1b[31mdisabled\x1b[0m";

  p.log.info(
    `Rule categories for ${repo.name}${isOverride ? " (per-repo override)" : " (global default)"}:`,
  );
  for (const cat of ALL_CATEGORIES) {
    console.log(`  ${cat.padEnd(14)} ${status(cat)}`);
  }
  console.log("");
  if (!isOverride) {
    p.log.info("Override with: truecourse rules categories --enable/--disable <name>");
  }
}

export interface RulesLlmOptions {
  enable?: boolean;
  disable?: boolean;
  reset?: boolean;
}

export async function runRulesLlm(options: RulesLlmOptions): Promise<void> {
  const repo = await requireRegisteredRepo();

  if (options.reset) {
    await updateProjectConfig(repo.path, { enableLlmRules: null });
    p.log.success("Reset LLM rules to global default.");
    return;
  }

  if (options.enable || options.disable) {
    const enabled = !!options.enable;
    await updateProjectConfig(repo.path, { enableLlmRules: enabled });
    p.log.success(`LLM rules ${enabled ? "enabled" : "disabled"} for ${repo.name}.`);
    return;
  }

  const config = await readProjectConfig(repo.path);
  const isOverride = config.enableLlmRules != null;
  const effective = isOverride ? config.enableLlmRules! : true;
  const status = effective ? "\x1b[32menabled\x1b[0m" : "\x1b[31mdisabled\x1b[0m";
  p.log.info(
    `LLM rules for ${repo.name}${isOverride ? " (per-repo override)" : " (global default)"}: ${status}`,
  );
  if (!isOverride) {
    p.log.info("Override with: truecourse rules llm --enable/--disable");
  }
}

// ---------------------------------------------------------------------------
// Per-rule enable/disable
// ---------------------------------------------------------------------------

const COLOR_ENABLED = "\x1b[32menabled\x1b[0m";
const COLOR_DISABLED = "\x1b[31mdisabled\x1b[0m";
const COLOR_DIM = (text: string) => `\x1b[2m${text}\x1b[0m`;

async function setRuleEnabled(repoPath: string, ruleKey: string, enabled: boolean): Promise<void> {
  const current = await readProjectConfig(repoPath);
  const set = new Set<string>(current.disabledRules ?? []);
  if (enabled) set.delete(ruleKey);
  else set.add(ruleKey);
  await updateProjectConfig(repoPath, { disabledRules: [...set].sort() });
}

async function requireRuleKey(ruleKey: string): Promise<void> {
  const all = await getRules();
  if (!all.some((r) => r.key === ruleKey)) {
    p.log.error(`Unknown rule: ${ruleKey}. Run 'truecourse rules list' to see available rules.`);
    process.exit(1);
  }
}

export interface RulesEnableOptions {
  ruleKey: string;
}

export async function runRulesEnable({ ruleKey }: RulesEnableOptions): Promise<void> {
  const repo = await requireRegisteredRepo();
  await requireRuleKey(ruleKey);
  await setRuleEnabled(repo.path, ruleKey, true);
  p.log.success(`Enabled rule '${ruleKey}' for ${repo.name}.`);
}

export async function runRulesDisable({ ruleKey }: RulesEnableOptions): Promise<void> {
  const repo = await requireRegisteredRepo();
  await requireRuleKey(ruleKey);
  await setRuleEnabled(repo.path, ruleKey, false);
  p.log.success(`Disabled rule '${ruleKey}' for ${repo.name}.`);
}

export interface RulesListOptions {
  domain?: string;
  disabled?: boolean;
  enabled?: boolean;
  search?: string;
}

export async function runRulesList(options: RulesListOptions): Promise<void> {
  const repo = await requireRegisteredRepo();
  const rules = await getRules(repo.path);

  const search = options.search?.toLowerCase();
  let filtered = rules;
  if (options.domain) {
    filtered = filtered.filter((r) => (r.domain ?? r.category) === options.domain);
  }
  if (options.enabled) filtered = filtered.filter((r) => r.enabled);
  if (options.disabled) filtered = filtered.filter((r) => !r.enabled);
  if (search) {
    filtered = filtered.filter(
      (r) =>
        r.key.toLowerCase().includes(search) ||
        r.name.toLowerCase().includes(search) ||
        r.description?.toLowerCase().includes(search),
    );
  }

  if (filtered.length === 0) {
    p.log.info("No rules match the given filters.");
    return;
  }

  const enabledCount = filtered.filter((r) => r.enabled).length;
  const disabledCount = filtered.length - enabledCount;
  p.log.info(
    `Rules for ${repo.name}: ${filtered.length} shown (${enabledCount} enabled, ${disabledCount} disabled).`,
  );

  const keyWidth = Math.min(
    60,
    filtered.reduce((max, r) => Math.max(max, r.key.length), 0),
  );

  for (const r of filtered) {
    const status = r.enabled ? COLOR_ENABLED : COLOR_DISABLED;
    const domain = r.domain ?? r.category;
    console.log(`  ${r.key.padEnd(keyWidth)}  ${status}  ${COLOR_DIM(`[${domain}/${r.severity}]`)}  ${r.name}`);
  }
  console.log("");
  p.log.info("Toggle with: truecourse rules enable <key> | truecourse rules disable <key>");
}

export interface RulesResetOptions {
  ruleKey?: string;
}

export async function runRulesReset({ ruleKey }: RulesResetOptions): Promise<void> {
  const repo = await requireRegisteredRepo();
  if (ruleKey) {
    await requireRuleKey(ruleKey);
    await setRuleEnabled(repo.path, ruleKey, true);
    p.log.success(`Re-enabled '${ruleKey}' for ${repo.name}.`);
    return;
  }
  await updateProjectConfig(repo.path, { disabledRules: [] });
  p.log.success(`Cleared per-rule overrides for ${repo.name}.`);
}
