/**
 * `truecourse guard interfaces` — the interface catalog's places, and the
 * authoring run that fills the half no derivation produces.
 *
 *   guard interfaces           what the catalog knows: places, and the tasks on them
 *   guard interfaces author    author the missing web tasks, one agent session per place
 *
 * The read view is free and LLM-less, like every other `guard` view, and it is
 * the SAME work list the authoring run takes — so the bill is visible before it
 * is paid, and after a run it is the record of what landed where.
 *
 * The run is the first stage of the agentic pipeline the user drives directly
 * (AGENTIC_PIPELINE_PLAN §3.2): one session per place, on the configured
 * transport's session driver, transcripts under
 * `.truecourse/sessions/guard-interfaces/<runId>/`.
 */

import * as p from "@clack/prompts";
import {
  readGuardInterfacesAuthorView,
  runGuardInterfaceAuthoring,
  type GuardInterfacesAuthorView,
} from "@truecourse/core/commands/guard-interfaces";
import type { PlaceResult } from "@truecourse/interface-author";
import { INTERFACE_AUTHOR_BUDGET } from "@truecourse/interface-author";
import { assertSessionBackendReady } from "@truecourse/core/services/llm/session-driver";
import { preflightLlmOrExit, type LlmTransportFlag } from "../lib/claude-preflight.js";
import { isInteractive } from "./helpers.js";

export interface RunGuardInterfacesOptions {
  cwd?: string;
}

/** The read view: every place, and what is authored on it. */
export async function runGuardInterfaces(opts: RunGuardInterfacesOptions = {}): Promise<void> {
  const repoRoot = opts.cwd ?? process.cwd();
  p.intro("Interfaces");
  const view = readGuardInterfacesAuthorView(repoRoot);
  printView(view);
  p.outro(
    view.unmapped
      ? "Nothing is mapped yet — run `truecourse guard setup` first."
      : view.places.some((place) => place.authored.length === 0)
        ? "Author the empty places with `truecourse guard interfaces author`."
        : "Every place carries at least one task.",
  );
}

export interface RunGuardInterfaceAuthorOptions extends RunGuardInterfacesOptions {
  /** Author only these places (repeatable `--place`). */
  place?: string[];
  /** Re-author places that already carry tasks. */
  replace?: boolean;
  limit?: number;
  yes?: boolean;
  llmTransport?: LlmTransportFlag;
}

export async function runGuardInterfacesAuthor(
  opts: RunGuardInterfaceAuthorOptions = {},
): Promise<void> {
  const repoRoot = opts.cwd ?? process.cwd();
  p.intro("Author interfaces");

  if (opts.llmTransport === "agent") {
    p.log.error(
      "--llm-transport agent has no session driver: an agent session needs a live backend (claude-code or api).",
    );
    p.outro("Aborted.");
    process.exit(1);
  }

  const view = readGuardInterfacesAuthorView(repoRoot);
  if (view.unmapped) {
    p.log.error(
      "No interface catalog. `truecourse guard setup` derives it — the places it finds are what authoring runs against.",
    );
    p.outro("Aborted.");
    process.exit(1);
  }

  const named = opts.place && opts.place.length > 0 ? new Set(opts.place) : undefined;
  const unknown = [...(named ?? [])].filter((id) => !view.places.some((place) => place.id === id));
  if (unknown.length > 0) {
    p.log.error(`No such place: ${unknown.join(", ")}.`);
    printView(view);
    p.outro("Aborted.");
    process.exit(1);
  }
  const selected = view.places.filter((place) =>
    named ? named.has(place.id) : opts.replace || place.authored.length === 0,
  );
  const work = opts.limit != null ? selected.slice(0, opts.limit) : selected;
  if (work.length === 0) {
    p.log.info(
      "Every place already carries a task. `--replace` re-authors them, `--place <id>` picks one.",
    );
    p.outro("Nothing to do.");
    return;
  }

  await preflightLlmOrExit(opts.llmTransport);
  // The backend the SESSIONS run on, probed once: without it every place would
  // fail with the same install line, after the confirm and after the spend.
  try {
    await assertSessionBackendReady(opts.llmTransport);
  } catch (error) {
    p.log.error(error instanceof Error ? error.message : String(error));
    p.outro("Aborted.");
    process.exit(1);
  }

  // The pre-flight, in the shape §3.5 fixes for every command: work items ×
  // the session's own turn range. Turns are what a session spends; presenting
  // an averaged dollar figure for a range this wide would dress a guess as a
  // fact, so the ceiling is stated as a ceiling.
  const maxTurns = INTERFACE_AUTHOR_BUDGET.turns * (INTERFACE_AUTHOR_BUDGET.maxResumes + 1);
  p.log.info(
    [
      `${work.length} place(s) to author, one agent session each.`,
      `Each session runs up to ${maxTurns} turns; most converge in a handful.`,
      ...work.map((place) => `  ${place.id}${place.address ? `  ${place.address}` : ""}`),
    ].join("\n"),
  );
  if (!opts.yes && isInteractive()) {
    const go = await p.confirm({ message: `Author ${work.length} place(s)?` });
    if (p.isCancel(go) || !go) {
      p.outro("Cancelled.");
      return;
    }
  }

  const spinner = p.spinner();
  spinner.start("Starting");
  let run;
  try {
    run = await runGuardInterfaceAuthoring({
      repoRoot,
      places: work.map((place) => place.id),
      ...(opts.replace !== undefined ? { replace: opts.replace } : {}),
      ...(opts.llmTransport ? { transport: opts.llmTransport } : {}),
      onProgress: (event) => {
        if (event.kind === "place-start") {
          spinner.message(`${event.placeId}  (${event.index + 1}/${event.total})`);
        }
      },
      onSessionEvent: (placeId, event) => {
        if (event.type === "assistant-turn" && event.toolCall) {
          spinner.message(`${placeId}  ${event.toolCall.name}`);
        }
      },
    });
  } catch (error) {
    spinner.stop("Failed");
    p.log.error(error instanceof Error ? error.message : String(error));
    p.outro("Aborted.");
    process.exit(1);
  }
  spinner.stop(`${run.places.length} session(s) on ${run.transport.model} (${run.transport.mode})`);

  for (const place of run.places) printPlace(place);
  if (run.skipped.length > 0) {
    p.log.info(`Skipped (already authored): ${run.skipped.join(", ")}`);
  }
  p.log.message(
    [
      `authored  ${run.authored} task(s)`,
      `turns     ${run.spent.turns}`,
      `tokens    ${run.spent.tokens.toLocaleString()}`,
      run.spent.costUsd > 0 ? `cost      $${run.spent.costUsd.toFixed(2)}` : "",
      run.path ? `written   ${run.path}` : "",
      `sessions  ${run.runDir}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const failed = run.places.filter((place) => place.status === "failed" || place.status === "rejected");
  if (failed.length > 0) process.exitCode = 1;
  p.outro(
    run.authored > 0
      ? "Review the authored tasks and commit `guard/interfaces.authored.json`."
      : "Nothing was authored.",
  );
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

function printView(view: GuardInterfacesAuthorView): void {
  const surfaces = [...new Set([...Object.keys(view.derived), ...Object.keys(view.authored)])].sort();
  p.log.message(
    surfaces.length === 0
      ? "No interfaces."
      : surfaces
          .map(
            (surface) =>
              `${surface.padEnd(5)}  ${view.derived[surface] ?? 0} derived · ${view.authored[surface] ?? 0} authored`,
          )
          .join("\n"),
  );
  if (view.places.length === 0) {
    p.log.info("No web places. Nothing derived a screen for this repository.");
    return;
  }
  p.log.message(
    view.places
      .map((place) => {
        const tasks =
          place.authored.length === 0 ? "no tasks" : `${place.authored.length} task(s)`;
        return `${place.id.padEnd(28)} ${(place.address ?? "—").padEnd(28)} ${tasks}`;
      })
      .join("\n"),
  );
}

function printPlace(place: PlaceResult): void {
  const spent = `${place.spent.turns} turn(s)`;
  switch (place.status) {
    case "authored":
      p.log.success(`${place.placeId} — ${place.taskIds.length} task(s), ${spent}\n  ${place.taskIds.join("\n  ")}`);
      break;
    case "empty":
      p.log.info(`${place.placeId} — no task the source states, ${spent}`);
      break;
    case "rejected":
      p.log.warn(
        `${place.placeId} — the draft broke the rules and was dropped, ${spent}\n  - ${place.problems.join("\n  - ")}`,
      );
      break;
    case "failed":
      p.log.error(`${place.placeId} — ${place.problems.join("; ")}, ${spent}`);
      break;
  }
  if (place.unresolved.length > 0) {
    p.log.message(`  unresolved:\n  - ${place.unresolved.join("\n  - ")}`);
  }
}
