/**
 * `truecourse guard externals` — the READ-ONLY view of this repo's third parties.
 *
 *   guard externals          the read-only view (what `--list` always printed)
 *   guard externals --list   the same thing, kept so existing scripts still work
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
}

export async function runGuardExternals(opts: RunGuardExternalsOptions = {}): Promise<void> {
  const repoRoot = opts.cwd ?? process.cwd();
  const view = readGuardExternalsView(repoRoot);

  p.intro("External APIs");

  if (view.invalidReason) p.log.error(view.invalidReason);

  printExternalsView(view);
  p.outro(
    view.services.length > 0
      ? "Provide an account with `truecourse guard setup` — declaring a service there is what unblocks its flows."
      : "Nothing to show.",
  );
}

// ---------------------------------------------------------------------------
// The read-only rendering — shared with `guard status`.
// ---------------------------------------------------------------------------

/**
 * One line per service: `<name>  <state> · <detail>`, declared services first.
 * `unprovided` is the honest default (its flows stay blocked); `incomplete` is the
 * one that needs action — a run stops on it — so its unmet requirements are named.
 *
 * `guard status` renders the same block (its externals footprint), so the two
 * surfaces can never drift.
 */
export function printExternalsView(view: GuardExternalsView): void {
  if (view.services.length === 0) {
    p.log.info(
      view.detectionAvailable
        ? "No external services detected or declared."
        : "No detection yet — run `truecourse guard setup`, which detects this repo's third parties and declares them.",
    );
    return;
  }
  p.log.step(`externals   ${view.services.length} service${view.services.length === 1 ? "" : "s"}`);
  for (const s of view.services) p.log.message(`    ${serviceLine(s)}`);
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
