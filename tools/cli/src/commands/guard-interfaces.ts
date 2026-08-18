/**
 * `truecourse guard interfaces` — the interface catalog's places, and the
 * authoring run that fills the half no derivation produces.
 *
 *   guard interfaces            what the catalog knows: places, and the tasks on them
 *   guard interfaces author     author the missing web tasks, one agent session per place
 *   guard interfaces reconcile  collapse the state registry's synonyms (one LLM call)
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
  runGuardInterfaceReconcile,
  type GuardInterfacesAuthorView,
} from "@truecourse/core/commands/guard-interfaces";
import type { PlaceResult, StateReconciliation } from "@truecourse/interface-author";
import { INTERFACE_AUTHOR_BUDGET, defaultAuthorConcurrency } from "@truecourse/interface-author";
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
  /** How many sessions run at once. */
  concurrency?: number;
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
  const concurrency = Math.max(1, opts.concurrency ?? defaultAuthorConcurrency());
  p.log.info(
    [
      `${work.length} place(s) to author, one agent session each, ${concurrency} at a time.`,
      `Each session runs up to ${maxTurns} turns; most converge in a handful.`,
      // The bill is stated before it is paid, and this call is part of it.
      "Plus one closing call to reconcile the state registry.",
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
  const live = liveProgress();
  spinner.start("Starting");
  let run;
  try {
    run = await runGuardInterfaceAuthoring({
      repoRoot,
      places: work.map((place) => place.id),
      ...(opts.replace !== undefined ? { replace: opts.replace } : {}),
      ...(opts.llmTransport ? { transport: opts.llmTransport } : {}),
      concurrency,
      onStatus: (message) => spinner.message(message),
      onProgress: (event) => {
        if (event.kind === "place-start") live.start(event.placeId, event.total);
        else live.done(event.place.placeId);
        spinner.message(live.render());
      },
      onSessionEvent: (placeId, event) => {
        if (event.type === "assistant-turn" && event.toolCall) {
          live.tool(placeId, event.toolCall.name);
          spinner.message(live.render());
        }
      },
    });
  } catch (error) {
    spinner.stop("Failed");
    p.log.error(error instanceof Error ? error.message : String(error));
    p.outro("Aborted.");
    process.exit(1);
  }
  // Provider AND model: "opus" alone does not say whose opus, and an api-mode
  // run against a gateway is otherwise indistinguishable from a direct one.
  spinner.stop(
    `${run.places.length} session(s) on ${run.transport.provider}/${run.transport.model}${
      run.transport.fallbackModel ? ` (fallback ${run.transport.fallbackModel})` : ""
    } via ${run.transport.mode}`,
  );

  for (const place of run.places) printPlace(place);
  if (run.skipped.length > 0) {
    p.log.info(`Skipped (already authored): ${run.skipped.join(", ")}`);
  }
  if (run.reconcile) printReconcileProblems(run.reconcile);
  p.log.message(
    [
      `context   ${run.context.places} place(s) grounded from ${run.context.files} file(s) in ${run.context.seconds}s`,
      `authored  ${run.authored} task(s)`,
      run.reconcile ? `states    ${describeReconcile(run.reconcile)}` : "",
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

export interface RunGuardInterfacesReconcileOptions extends RunGuardInterfacesOptions {
  yes?: boolean;
  llmTransport?: LlmTransportFlag;
}

/**
 * `guard interfaces reconcile` — collapse the state registry's synonyms without
 * authoring anything. The authoring run closes with this pass already, so this
 * command is for the catalog that was authored before it existed, or one whose
 * registry drifted apart across several partial runs. ONE model call, whatever
 * the app's size, and it rewrites references only: no fingerprint moves, so no
 * scenario is invalidated by running it.
 */
export async function runGuardInterfacesReconcile(
  opts: RunGuardInterfacesReconcileOptions = {},
): Promise<void> {
  const repoRoot = opts.cwd ?? process.cwd();
  p.intro("Reconcile states");

  const view = readGuardInterfacesAuthorView(repoRoot);
  if (view.unmapped) {
    p.log.error(
      "No interface catalog. `truecourse guard setup` derives it — the places it finds are what authoring runs against.",
    );
    p.outro("Aborted.");
    process.exit(1);
  }

  await preflightLlmOrExit(opts.llmTransport);
  p.log.info(
    "One LLM call over the whole state registry: ids that name the same world are collapsed, and every `startingState`/`endState` that referenced one is rewritten. No fingerprint moves.",
  );
  if (!opts.yes && isInteractive()) {
    const go = await p.confirm({ message: "Reconcile the state registry?" });
    if (p.isCancel(go) || !go) {
      p.outro("Cancelled.");
      return;
    }
  }

  const spinner = p.spinner();
  spinner.start("Reconciling");
  let result;
  try {
    result = await runGuardInterfaceReconcile({
      repoRoot,
      ...(opts.llmTransport ? { transport: opts.llmTransport } : {}),
    });
  } catch (error) {
    spinner.stop("Failed");
    p.log.error(error instanceof Error ? error.message : String(error));
    p.outro("Aborted.");
    process.exit(1);
  }
  spinner.stop(`states ${describeReconcile(result)}`);

  for (const merge of result.merges) {
    p.log.message(`  ${merge.keep} ← ${merge.absorb.join(", ")}`);
  }
  printReconcileProblems(result);
  if (result.path) p.log.message(`written   ${result.path}`);

  if (result.status === "rejected") process.exitCode = 1;
  p.outro(
    result.status === "reconciled"
      ? "Review the registry and commit `guard/interfaces.authored.json`."
      : result.status === "rejected"
        ? "Nothing was written."
        : "The registry already names each world once.",
  );
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

/** `N→M (K merged)` — the one line both the run footer and this command print. */
function describeReconcile(result: StateReconciliation): string {
  return `${result.before}→${result.after} (${result.merged} merged)`;
}

/** A dropped group is a report, never a silent correction — so it is printed. */
function printReconcileProblems(result: StateReconciliation): void {
  if (result.dropped.length > 0) {
    p.log.warn(`Dropped ${result.dropped.length} proposed group(s):\n  - ${result.dropped.join("\n  - ")}`);
  }
  if (result.problems.length > 0) {
    const say = result.status === "rejected" ? p.log.error : p.log.warn;
    say(`State reconciliation:\n  - ${result.problems.join("\n  - ")}`);
  }
}

/**
 * One spinner line for a pool of sessions. With one session in flight the line
 * is what it always was — the place, and the tool it just called, which is the
 * only liveness signal a 30-turn session gives. With several, per-place tool
 * calls arrive interleaved from every session and a line showing the last one
 * flickers between places without saying anything, so the line becomes the
 * aggregate: how many are done, and who is still working.
 */
function liveProgress() {
  const inFlight = new Map<string, string>();
  let done = 0;
  let total = 0;
  return {
    start(placeId: string, of: number) {
      total = of;
      inFlight.set(placeId, "");
    },
    tool(placeId: string, name: string) {
      if (inFlight.has(placeId)) inFlight.set(placeId, name);
    },
    done(placeId: string) {
      inFlight.delete(placeId);
      done += 1;
    },
    render(): string {
      const counted = `${done}/${total}`;
      if (inFlight.size === 1) {
        const [placeId, tool] = [...inFlight][0]!;
        return `${placeId}${tool ? `  ${tool}` : ""}  (${counted})`;
      }
      return `${counted} done · ${inFlight.size} running · ${clip([...inFlight.keys()].join(", "), 56)}`;
    },
  };
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

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
  if (place.raced && place.raced.length > 0) {
    p.log.message(`  authored by another session first:\n  - ${place.raced.join("\n  - ")}`);
  }
  if (place.unresolved.length > 0) {
    p.log.message(`  unresolved:\n  - ${place.unresolved.join("\n  - ")}`);
  }
}
