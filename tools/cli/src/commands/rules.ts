import * as p from "@clack/prompts";
import { DOMAIN_ORDER } from "@truecourse/shared";
import {
  readProjectConfig,
  updateProjectConfig,
} from "@truecourse/server/config/project-config";
import { requireRegisteredRepo } from "./helpers.js";

const ALL_CATEGORIES = [...DOMAIN_ORDER] as string[];

export interface RulesCategoriesOptions {
  enable?: string;
  disable?: string;
  reset?: boolean;
}

export async function runRulesCategories(options: RulesCategoriesOptions): Promise<void> {
  const repo = requireRegisteredRepo();

  if (options.reset) {
    updateProjectConfig(repo.path, { enabledCategories: null });
    p.log.success("Reset to global default categories.");
    return;
  }

  if (options.enable || options.disable) {
    const cat = options.enable ?? options.disable!;
    if (!ALL_CATEGORIES.includes(cat)) {
      p.log.error(`Invalid category: ${cat}. Valid: ${ALL_CATEGORIES.join(", ")}`);
      process.exit(1);
    }

    const config = readProjectConfig(repo.path);
    const hasOverride = config.enabledCategories != null;
    const current = new Set<string>(hasOverride ? config.enabledCategories! : ALL_CATEGORIES);

    if (options.enable) current.add(cat);
    else current.delete(cat);

    updateProjectConfig(repo.path, { enabledCategories: [...current] });
    p.log.success(`${options.enable ? "Enabled" : "Disabled"} ${cat} rules for ${repo.name}.`);
    return;
  }

  const config = readProjectConfig(repo.path);
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
  const repo = requireRegisteredRepo();

  if (options.reset) {
    updateProjectConfig(repo.path, { enableLlmRules: null });
    p.log.success("Reset LLM rules to global default.");
    return;
  }

  if (options.enable || options.disable) {
    const enabled = !!options.enable;
    updateProjectConfig(repo.path, { enableLlmRules: enabled });
    p.log.success(`LLM rules ${enabled ? "enabled" : "disabled"} for ${repo.name}.`);
    return;
  }

  const config = readProjectConfig(repo.path);
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
