/**
 * `truecourse guard externals` — the READ-ONLY view of this repo's third parties.
 *
 *   guard externals          the read-only view (what `--list` always printed)
 *   guard externals --list   the same thing, kept so existing scripts still work
 *   guard externals --all    every detected service, hidden ones in their own block
 *
 * The DEFAULT is the RELEVANT services (core's `relevant` flag: blocked flows, a
 * scenario that scripts faults on it, an incomplete account, or a declaration a human
 * touched). Detection alone is an engine fact about the code, not a chore: a first
 * setup on a real repo detects dozens of vendors and none of them needs anything until
 * `guard generate` binds a flow to one, so they are counted in a single line rather
 * than listed as a wall of warnings.
 *
 * Provisioning — picking a service and handing guard an account — moved into
 * `truecourse guard setup`. It has to: DECLARING a service is what enters the recipe
 * fingerprint and re-authors the sections it used to block, so it belongs in the
 * stage that runs before the first (expensive) generate. Supplying the VALUE
 * afterwards is free by construction (it lands in the gitignored overlay, which no
 * fingerprint sees), which is exactly why setup declares every detected service up
 * front even when there is no account for it yet.
 */

import * as p from "@clack/prompts";
import {
  readGuardExternalsView,
  type GuardExternalServiceView,
  type GuardExternalsView,
} from "@truecourse/core/commands/guard-externals";

export interface RunGuardExternalsOptions {
  cwd?: string;
  /** Kept for compatibility — the view is now this command's only behaviour. */
  list?: boolean;
  /** Print the services no flow needs too, in their own block. */
  all?: boolean;
}

export async function runGuardExternals(opts: RunGuardExternalsOptions = {}): Promise<void> {
  const repoRoot = opts.cwd ?? process.cwd();
  const view = readGuardExternalsView(repoRoot);

  p.intro("External APIs");

  if (view.invalidReason) p.log.error(view.invalidReason);

  printExternalsView(view, { all: opts.all === true, offerAll: opts.all !== true });
  p.outro(
    view.services.some((s) => s.relevant)
      ? "Provide an account with `truecourse guard setup` — declaring a service there is what unblocks its flows."
      : view.services.length > 0
        ? "Nothing here needs an account yet."
        : "Nothing to show.",
  );
}

// ---------------------------------------------------------------------------
// The read-only rendering — shared with `guard status`.
// ---------------------------------------------------------------------------

export interface PrintExternalsOptions {
  /** List the irrelevant services too, under their own heading. */
  all?: boolean;
  /** Name `--all` in the hidden-count line — only `guard externals` has that flag. */
  offerAll?: boolean;
}

/**
 * One line per RELEVANT service: `<name>  <state> · <detail>`, declared services
 * first. `unprovided` is the honest default (its flows stay blocked); `incomplete` is
 * the one that needs action — a run stops on it — so its unmet requirements are named.
 *
 * The services no flow needs are one counted line, not rows: they are the same
 * information a `detected` list already gave, and a first run has dozens of them.
 * Under `--all` they get their own block instead — kept SEPARATE from the rows that
 * matter, because interleaving them back is exactly the wall this removes.
 *
 * `guard status` renders the same block (its externals footprint) with no `--all` to
 * offer, so the two surfaces can never drift on what they consider worth showing.
 */
export function printExternalsView(view: GuardExternalsView, opts: PrintExternalsOptions = {}): void {
  if (view.services.length === 0) {
    p.log.info(
      view.detectionAvailable
        ? "No external services detected or declared."
        : "No detection yet — run `truecourse guard setup`, which detects this repo's third parties and declares them.",
    );
    return;
  }

  const relevant = view.services.filter((s) => s.relevant);
  const hidden = view.services.filter((s) => !s.relevant);
  const everyHiddenServiceWasDetected = hidden.every((s) => s.detected);
  if (relevant.length > 0) {
    p.log.step(`externals   ${relevant.length} service${relevant.length === 1 ? "" : "s"}`);
    for (const s of relevant) p.log.message(`    ${serviceLine(s)}`);
  }
  if (hidden.length > 0) {
    if (opts.all) {
      p.log.step(
        `${everyHiddenServiceWasDetected ? "detected, not needed by any flow" : "not needed by any flow"}   ${hidden.length}`,
      );
      for (const s of hidden) p.log.message(`    ${serviceLine(s)}`);
    } else {
      const inventory = everyHiddenServiceWasDetected
        ? "detected in code, not needed by any flow"
        : `${hidden.length === 1 ? "service" : "services"} not needed by any flow`;
      p.log.message(
        `    ${hidden.length} ${relevant.length > 0 ? "more " : ""}${inventory}` +
          (opts.offerAll ? " — see them with `truecourse guard externals --all`" : ""),
      );
    }
  }
  if (!view.detectionAvailable) {
    p.log.message(
      "    (no detection yet — run `truecourse guard setup`; only declared services are listed)",
    );
  }
}

/** `<name>  <state> · <detail>` — the one-line summary both surfaces print. */
export function serviceLine(s: GuardExternalServiceView): string {
  const state = s.declared ? s.state : "unprovided";
  const detail: string[] = [];
  if (s.baseUrl) detail.push(s.mode ? `${s.mode} @ ${s.baseUrl}` : s.baseUrl);
  // A multi-host service is only half described by its primary origin.
  const extra = Object.keys(s.endpoints ?? {}).length;
  if (extra > 0) detail.push(`+${extra} endpoint${extra === 1 ? "" : "s"}`);
  if (state === "incomplete") detail.push(...unmet(s));
  if (!s.declared) detail.push("not declared in recipe.json");
  if (s.blockedFlows > 0) {
    detail.push(`${s.blockedFlows} blocked flow${s.blockedFlows === 1 ? "" : "s"}`);
  }
  return `${s.service}  ${state}${detail.length > 0 ? ` · ${detail.join(" · ")}` : ""}`;
}

/** The requirements that did not resolve, as `VAR: why` — rendered verbatim. */
function unmet(s: GuardExternalServiceView): string[] {
  return s.requirements
    .filter((r) => !r.resolved)
    .map((r) => `${r.envVar}: ${r.reason ?? "unresolved"}`);
}
