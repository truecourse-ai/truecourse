/**
 * `truecourse guard recipe` — the preparation recipe, READ-ONLY (item 78).
 *
 *   guard recipe   print `.truecourse/scenarios/recipe.json` + its staleness
 *
 * Deriving a recipe used to live here (`--init` / `--refresh`). It moved into
 * `truecourse guard setup`, and this command lost its write path entirely — not for
 * tidiness, but because derivation must exist in exactly ONE place: it edits
 * recipe.json, which moves the recipe fingerprint, which re-authors every section
 * generated against it. A second door onto that would let a user prepare the repo
 * behind the gate's back, after the expensive stage had already paid for the old
 * answer.
 */

import path from "node:path";
import * as p from "@clack/prompts";
import { resolveApiServers, type Recipe } from "@truecourse/guard-runner";
import {
  readGuardRecipeView,
  type GuardRecipeView,
} from "@truecourse/core/commands/guard-in-process";

export interface RunGuardRecipeOptions {
  cwd?: string;
  /**
   * Accepted so the removed write flags fail LOUDLY rather than as an unknown
   * option — a script or an agent that still passes `--init`/`--refresh` is told
   * where derivation went instead of silently printing the recipe it meant to write.
   */
  init?: boolean;
  refresh?: boolean;
}

export async function runGuardRecipe(opts: RunGuardRecipeOptions = {}): Promise<void> {
  const repoRoot = opts.cwd ?? process.cwd();
  p.intro("Guard recipe");

  if (opts.init || opts.refresh) {
    p.log.error(
      "`guard recipe` no longer derives a recipe — `truecourse guard setup` does, before the first (expensive) generate.",
    );
    p.log.message(
      "  Setup derives and verifies the recipe, declares the external APIs this repo talks to, and prepares the seed,",
    );
    p.log.message(
      "  so fixing any of it costs nothing. `guard recipe` shows what setup left.",
    );
    p.outro("Run `truecourse guard setup`.");
    process.exit(1);
    return;
  }

  const view = await readGuardRecipeView(repoRoot);
  const rel = path.relative(repoRoot, view.path) || view.path;

  if (view.invalidReason) {
    p.log.error(`${rel} does not parse:`);
    for (const line of view.invalidReason.split("\n")) console.log(`  ${line}`);
    p.outro("Fix it (or re-derive with `truecourse guard setup --refresh`).");
    process.exit(1);
    return;
  }
  if (!view.recipe) {
    p.log.warn(`No recipe yet — ${rel} does not exist.`);
    p.log.message("  Every scenario runs against the recipe: how to install, build, and start this repo.");
    p.outro("Derive one with `truecourse guard setup`.");
    return;
  }

  printRecipe(view.recipe, rel);
  printStaleness(view);
  // The SAME credential-`satisfies` verdict `guard generate` enforces — an
  // unresolvable scheme name is inert at run time, so it is shown here (where the
  // recipe is being read) rather than only when a generate refuses to start.
  for (const error of view.credentialSchemes.errors) {
    p.log.error(`${error} \`truecourse guard generate\` will refuse to run until this is fixed.`);
  }
  for (const warning of view.credentialSchemes.warnings) p.log.warn(warning);
  p.outro("Re-derive it with `truecourse guard setup --refresh`.");
}

/** The recipe as the terminal shows it: every field, secrets never printed. */
function printRecipe(recipe: Recipe, rel: string): void {
  p.log.step(rel);
  if (recipe.install) p.log.message(`  install     ${recipe.install}`);
  p.log.message(`  build       ${recipe.build}`);
  if (recipe.entry) p.log.message(`  entry       ${recipe.entry.join(" ")}`);
  for (const [name, value] of Object.entries(recipe.env ?? {})) {
    p.log.message(`  env         ${name}=${value}`);
  }
  const api = recipe.api;
  if (!api) return;
  // Item 75: one line per declared server, both recipe shapes collapsed — a
  // single-server recipe prints exactly the one line it always did.
  const resolved = resolveApiServers(recipe);
  for (const server of resolved.servers.values()) {
    const label =
      resolved.servers.size > 1
        ? `${server.name}${server.name === resolved.defaultServer ? " (default)" : ""}`
        : "";
    p.log.message(`  serve       ${label ? `${label}: ` : ""}${server.serve.join(" ")}`);
    p.log.message(`  health      ${server.healthPath}`);
    if (server.app) p.log.message(`  app         ${server.app}`);
  }
  if (api.readyTimeoutMs) p.log.message(`  ready in    ${api.readyTimeoutMs}ms`);
  for (const [name, value] of Object.entries(api.env ?? {})) {
    p.log.message(`  api env     ${name}=${value}`);
  }
  if (api.services) {
    p.log.message(`  services    up: ${api.services.up}${api.services.down ? ` · down: ${api.services.down}` : ""}`);
  }
  for (const [name, cred] of Object.entries(api.credentials ?? {})) {
    p.log.message(`  credential  ${name} → ${cred.header}: ${credentialSource(cred)}${roleSuffix(cred)}`);
  }
  if (api.seed) {
    p.log.message(`  seed        ${api.seed.command}`);
    for (const [name, cred] of Object.entries(api.seed.provides.credentials ?? {})) {
      p.log.message(`  seeds cred  ${name} → ${cred.header} (minted at run time)${roleSuffix(cred)}`);
    }
    for (const [name, fields] of Object.entries(api.seed.provides.fixtures ?? {})) {
      p.log.message(`  seeds data  ${name} (${fields.join(", ")})`);
    }
  }
}

/**
 * Where a credential's value comes from. An env-var NAME is a capability, so it
 * prints; an inline `value` IS the secret, so it never leaves the file — masked
 * to its length so "the value is there" stays visible.
 */
function credentialSource(cred: {
  value?: string;
  valueFromEnv?: string;
  fromRequest?: { method: string; path: string };
}): string {
  if (cred.fromRequest)
    return `${cred.fromRequest.method} ${cred.fromRequest.path} (minted at run start)`;
  if (cred.valueFromEnv) return `$${cred.valueFromEnv}`;
  return "•".repeat(Math.min(cred.value?.length ?? 0, 12)) + " (inline value, masked)";
}

function roleSuffix(cred: { description?: string }): string {
  return cred.description ? ` — ${cred.description}` : "";
}

/** The discovery-input fingerprint + whether it moved since the last run. */
function printStaleness(view: GuardRecipeView): void {
  p.log.message(`  inputs      ${view.fingerprint ?? "(unknown)"}`);
  if (view.stale === null) {
    p.log.message("  staleness   no guard run to compare against yet");
  } else if (view.stale) {
    p.log.warn(
      "The recipe's discovery inputs (package.json, lockfile, build config) changed since the last guard run — the recipe may no longer describe this repo.",
    );
  } else {
    p.log.message("  staleness   current — unchanged since the last guard run");
  }
}
