/**
 * `truecourse guard recipe` — the preparation recipe: show it, or derive it.
 *
 *   guard recipe            print `.truecourse/scenarios/recipe.json` + its staleness
 *   guard recipe --init     derive a recipe for a repo that has none, and write it
 *   guard recipe --refresh  re-derive over an existing recipe, printing the diff
 *
 * NON-INTERACTIVE by design (the whole recipe program is agent-drivable and
 * CI-safe): it never prompts. What discovery could not decide is PRINTED as a TODO
 * list, and a secret is never fabricated.
 *
 * Discovery is the same `discoverRecipe` `guard generate` runs — the deterministic
 * proposer over the repo's own manifests first, the model as the fallback, and the
 * engine's install → build → boot/probe verification over both. Nothing reaches
 * disk unless it verified, so a failed `--refresh` leaves the existing recipe
 * untouched; git (recipe.json is committed) is the safety net for a successful one,
 * which is why the replaced content is DIFFED to the terminal rather than backed up.
 */

import path from "node:path";
import * as p from "@clack/prompts";
import { resolveApiServers, type Recipe } from "@truecourse/guard-runner";
import type { RecipeRunner } from "@truecourse/guard-generator";
import {
  readGuardRecipeView,
  guardRecipeDiscoverInProcess,
  type GuardRecipeView,
} from "@truecourse/core/commands/guard-in-process";
import { unifiedDiff } from "../lib/unified-diff.js";

export interface RunGuardRecipeOptions {
  cwd?: string;
  /** Derive + write a recipe for a repo that has none (`--init`). */
  init?: boolean;
  /** Re-derive over an existing recipe, replacing it only if it verifies (`--refresh`). */
  refresh?: boolean;
  /** LLM transport for the fallback proposer: `cli` (default) or `agent`. */
  llmTransport?: "cli" | "agent";
  io?: string;
  /** Test seam: the fallback model proposer (production spawns the transport). */
  recipeRunner?: RecipeRunner;
}

export async function runGuardRecipe(opts: RunGuardRecipeOptions = {}): Promise<void> {
  const repoRoot = opts.cwd ?? process.cwd();
  p.intro("Guard recipe");

  if (opts.init && opts.refresh) {
    p.log.error("`--init` and `--refresh` are opposites: --init refuses an existing recipe, --refresh replaces one.");
    p.outro("Pick one.");
    process.exit(1);
    return;
  }

  const view = await readGuardRecipeView(repoRoot);
  const rel = path.relative(repoRoot, view.path) || view.path;

  if (opts.init || opts.refresh) {
    await discover(repoRoot, rel, view, opts);
    return;
  }

  if (view.invalidReason) {
    p.log.error(`${rel} does not parse:`);
    for (const line of view.invalidReason.split("\n")) console.log(`  ${line}`);
    p.outro("Fix it (or re-derive with `truecourse guard recipe --refresh`).");
    process.exit(1);
    return;
  }
  if (!view.recipe) {
    p.log.warn(`No recipe yet — ${rel} does not exist.`);
    p.log.message("  Every scenario runs against the recipe: how to install, build, and start this repo.");
    p.outro("Derive one with `truecourse guard recipe --init`.");
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
  p.outro("Re-derive it with `truecourse guard recipe --refresh`.");
}

/** `--init` / `--refresh`: derive, verify, write, and report what changed. */
async function discover(
  repoRoot: string,
  rel: string,
  view: GuardRecipeView,
  opts: RunGuardRecipeOptions,
): Promise<void> {
  const existed = view.recipe !== null || view.invalidReason !== null;
  if (opts.init && existed) {
    p.log.error(`${rel} already exists — \`--init\` never overwrites a reviewed recipe.`);
    p.outro("Re-derive it with `truecourse guard recipe --refresh`.");
    process.exit(1);
    return;
  }
  // The old TEXT, captured before discovery can replace it — the diff's left side.
  const before = view.recipe ? recipeText(view.recipe) : null;

  p.log.step(
    existed
      ? "Re-deriving the recipe (the repo's own manifests first, the model only if they don't decide)…"
      : "Deriving a recipe (the repo's own manifests first, the model only if they don't decide)…",
  );

  const result = await guardRecipeDiscoverInProcess(repoRoot, {
    llm: opts.llmTransport,
    io: opts.io,
    ...(opts.recipeRunner ? { recipeRunner: opts.recipeRunner } : {}),
    ...(opts.refresh ? { ignoreExisting: true } : {}),
  });

  if (result.status === "verify-failed") {
    p.log.error(`Recipe discovery failed: ${result.reason}`);
    if (result.proposal) {
      p.log.message("  the last proposal the engine ran:");
      for (const line of JSON.stringify(result.proposal, null, 2).split("\n")) console.log(`    ${line}`);
    }
    p.outro(
      existed
        ? `${rel} was left untouched — nothing is written unless it verifies.`
        : `Nothing written. Hand-write ${rel} (see the README) and re-run.`,
    );
    process.exit(1);
    return;
  }
  // `exists` is unreachable under --init (refused above) and --refresh (ignores it),
  // but the status is part of the discovery contract — report it rather than assume.
  if (result.status === "exists") {
    p.log.info(`${rel} already exists — nothing was derived.`);
    printRecipe(result.recipe, rel);
    p.outro("Re-derive it with `truecourse guard recipe --refresh`.");
    return;
  }

  const how =
    result.source === "deterministic"
      ? "derived from the repo's own manifests — no LLM call"
      : "proposed by the model, verified by the engine";
  p.log.success(`wrote ${result.wrotePath} (${how})`);
  // Item 68: the generated datastore is a second artifact, at the REPO ROOT — say
  // so where the recipe is reported, never leave it to `git status` to reveal.
  if (result.composePath) {
    p.log.success(
      `wrote ${result.composePath} — the datastore this repo needs, derived from the connection URL its own source declares`,
    );
  }

  const after = recipeText(result.recipe);
  if (before !== null && before !== after) {
    p.log.step("What changed (the previous recipe is in git — that is the undo):");
    for (const line of unifiedDiff(before, after)) console.log(`  ${line}`);
  } else if (before !== null) {
    p.log.info("Identical to the recipe that was already there.");
  }

  printRecipe(result.recipe, rel);
  if (result.todos.length > 0) {
    p.log.warn(`${result.todos.length} TODO${result.todos.length === 1 ? "" : "s"} the recipe could not decide:`);
    for (const todo of result.todos) console.log(`  • ${todo}`);
  }
  p.outro(
    result.composePath
      ? `Review and commit BOTH (${result.wrotePath} and ${result.composePath}) — they are committed, human-reviewed files.`
      : "Review and commit it — the recipe is a committed, human-reviewed file.",
  );
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

/** The recipe as it is written to disk — the diff operates on this exact text. */
function recipeText(recipe: Recipe): string {
  return JSON.stringify(recipe, null, 2) + "\n";
}
