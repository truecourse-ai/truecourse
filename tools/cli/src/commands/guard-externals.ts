/**
 * `truecourse guard externals` — the interactive provisioning of a third party's
 * account (item 62).
 *
 *   guard externals          interactive: pick a service, hand guard an account
 *   guard externals --list   the read-only view (also what a non-TTY run prints)
 *
 * The engine half is `@truecourse/core/commands/guard-externals`: this command is a
 * thin adapter over `readGuardExternalsView` / `writeGuardExternals` and owns
 * nothing but the prompts. The SECRECY split is the thing the prompts must make
 * obvious — a pasted value goes to the gitignored `externals.local.json`, a shell
 * variable NAME and an explicitly-inline value go to the committed `recipe.json` —
 * so each source option says where it lands before it is chosen.
 *
 * A secret is never echoed: it is typed into a clack password prompt and read back
 * only as `••••` + its last four characters, in the confirmation summary and
 * nowhere else.
 */

import * as p from "@clack/prompts";
import {
  readGuardExternalsView,
  writeGuardExternals,
  GuardExternalsWriteError,
  type GuardExternalEnvPatch,
  type GuardExternalPatch,
  type GuardExternalServiceView,
  type GuardExternalsView,
} from "@truecourse/core/commands/guard-externals";

export interface RunGuardExternalsOptions {
  cwd?: string;
  /** Print the read-only view and stop — the non-TTY behaviour, forced. */
  list?: boolean;
  /**
   * Test seam / explicit override: whether the terminal can prompt. Defaults to
   * `process.stdin.isTTY` — a piped or CI run reads as non-interactive and lists.
   */
  interactive?: boolean;
}

export async function runGuardExternals(opts: RunGuardExternalsOptions = {}): Promise<void> {
  const repoRoot = opts.cwd ?? process.cwd();
  const view = readGuardExternalsView(repoRoot);
  const interactive =
    opts.interactive ?? (Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY));

  p.intro("External APIs");

  if (view.invalidReason) p.log.error(view.invalidReason);

  if (opts.list || !interactive) {
    printExternalsView(view);
    p.outro(
      opts.list || view.services.length > 0
        ? "Run `truecourse guard externals` in a terminal to provide an account."
        : "Nothing to show.",
    );
    return;
  }

  await provision(repoRoot, view);
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
        : "No generate report yet — detection has not run, so nothing is known about this repo's third parties.",
    );
    return;
  }
  p.log.step(`externals   ${view.services.length} service${view.services.length === 1 ? "" : "s"}`);
  for (const s of view.services) p.log.message(`    ${serviceLine(s)}`);
  if (!view.detectionAvailable) {
    p.log.message(
      "    (no generate report yet — detection has not run, so only declared services are listed)",
    );
  }
}

/** `<name>  <state> · <detail>` — the one-line summary both surfaces print. */
export function serviceLine(s: GuardExternalServiceView): string {
  const state = s.declared ? s.state : "unprovided";
  const detail: string[] = [];
  if (s.baseUrl) detail.push(s.mode ? `${s.mode} @ ${s.baseUrl}` : s.baseUrl);
  if (state === "incomplete") detail.push(...unmet(s));
  if (!s.declared) detail.push("not declared in recipe.json");
  if (s.blockedFlows > 0) {
    detail.push(`${s.blockedFlows} blocked flow${s.blockedFlows === 1 ? "" : "s"}`);
  }
  return `${s.service}  ${state}${detail.length > 0 ? ` · ${detail.join(" · ")}` : ""}`;
}

/** The select-list hint: the state plus the reason it matters (blocked flows). */
function serviceHint(s: GuardExternalServiceView): string {
  const state = s.declared ? s.state : "unprovided";
  const parts: string[] = [state];
  if (!s.declared) parts.push("not declared");
  if (s.blockedFlows > 0) parts.push(`${s.blockedFlows} blocked flow${s.blockedFlows === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/** The requirements that did not resolve, as `VAR: why` — rendered verbatim. */
function unmet(s: GuardExternalServiceView): string[] {
  return s.requirements
    .filter((r) => !r.resolved)
    .map((r) => `${r.envVar}: ${r.reason ?? "unresolved"}`);
}

// ---------------------------------------------------------------------------
// The interactive write.
// ---------------------------------------------------------------------------

/** Every prompt goes through this: a cancel exits cleanly, having written nothing. */
function bail<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Cancelled — nothing was written.");
    process.exit(0);
  }
  return value as T;
}

async function provision(repoRoot: string, view: GuardExternalsView): Promise<void> {
  printExternalsView(view);

  const choice = bail(
    await p.select({
      message: "Which service?",
      options: [
        ...view.services.map((s) => ({
          value: s.service,
          label: s.service,
          hint: serviceHint(s),
        })),
        { value: "\0new", label: "Add a service manually", hint: "one TrueCourse cannot see" },
      ],
    }),
  );

  const existing = view.services.find((s) => s.service === choice) ?? null;
  const service =
    choice === "\0new"
      ? bail(
          await p.text({
            message: "Service name (the recipe key)",
            placeholder: "stripe",
            validate: (v) => {
              if (!v?.trim()) return "Name the service.";
              if (view.services.some((s) => s.service === v.trim())) {
                return "That service is already listed — pick it from the list instead.";
              }
              return undefined;
            },
          }),
        ).trim()
      : choice;

  // A declared service can also be cleared — the write's `null` entry drops the
  // declaration AND its stored values.
  if (existing?.declared) {
    const action = bail(
      await p.select({
        message: `${service} is declared. What now?`,
        options: [
          { value: "edit", label: "Edit the account" },
          { value: "remove", label: "Remove the declaration", hint: "and its stored values" },
        ],
      }),
    );
    if (action === "remove") {
      const sure = bail(
        await p.confirm({ message: `Remove ${service} from recipe.json?`, initialValue: false }),
      );
      if (!sure) {
        p.outro("Nothing written.");
        return;
      }
      write(repoRoot, service, null, "removed");
      return;
    }
  }

  const baseUrlEnv = bail(
    await p.text({
      message: "Env var your app reads this service's base URL from",
      placeholder: "STRIPE_BASE_URL",
      ...(existing?.baseUrlEnv ? { initialValue: existing.baseUrlEnv } : {}),
      validate: (v) => (v?.trim() ? undefined : "Required — it is the variable the runner sets."),
    }),
  ).trim();
  if (existing?.baseUrlEnvSource === "detected") {
    p.log.message("  (pre-filled from the code — TrueCourse saw the app read this variable)");
  }

  const baseUrl = bail(
    await p.text({
      message: "Base URL of the account (committed — an origin is not a secret)",
      placeholder: "https://api.sandbox.stripe.com",
      ...(existing?.baseUrl ? { initialValue: existing.baseUrl } : {}),
    }),
  ).trim();

  const mode = bail(
    await p.select({
      message: "What kind of account is it?",
      initialValue: existing?.mode ?? "sandbox",
      options: [
        { value: "sandbox", label: "sandbox", hint: "test-mode credentials" },
        { value: "real", label: "real", hint: "the live service — tests will hit it" },
        { value: "", label: "don't say" },
      ],
    }),
  );

  const description = bail(
    await p.text({
      message: "Description (optional)",
      placeholder: "test-mode account, no live charges",
      ...(existing?.description ? { initialValue: existing.description } : {}),
      defaultValue: "",
    }),
  ).trim();

  const env = await collectEnvVars(existing);

  // The summary is the LAST place a value could leak — every one of them is masked.
  const lines = [
    `service     ${service}`,
    `base url    ${baseUrl || "(none — the service stays unprovided)"}`,
    `url env     ${baseUrlEnv}`,
    ...(mode ? [`mode        ${mode}`] : []),
    ...(description ? [`about       ${description}`] : []),
    ...Object.entries(env).map(([name, source]) => `env         ${name} → ${describeSource(source)}`),
  ];
  p.note(lines.join("\n"), "About to write");

  const go = bail(await p.confirm({ message: "Write it?", initialValue: true }));
  if (!go) {
    p.outro("Nothing written.");
    return;
  }

  write(
    repoRoot,
    service,
    {
      baseUrlEnv,
      ...(baseUrl ? { baseUrl } : {}),
      ...(mode === "sandbox" || mode === "real" ? { mode } : {}),
      ...(description ? { description } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    },
    "saved",
  );
}

/** The "add another env var?" loop — name, then WHERE its value lives. */
async function collectEnvVars(
  existing: GuardExternalServiceView | null,
): Promise<Record<string, GuardExternalEnvPatch>> {
  const env: Record<string, GuardExternalEnvPatch> = {};
  const declared = (existing?.requirements ?? []).filter((r) => r.kind === "env");
  if (declared.length > 0) {
    p.log.message(
      `  already declared: ${declared
        .map((r) => `${r.envVar} (${r.resolved ? "set" : r.reason ?? "unresolved"})`)
        .join(", ")} — re-enter one to replace it, leave it out to keep it`,
    );
  }

  for (;;) {
    const more = bail(
      await p.confirm({
        message: Object.keys(env).length === 0 ? "Add an env var (an API key, say)?" : "Add another?",
        initialValue: Object.keys(env).length === 0 && declared.length === 0,
      }),
    );
    if (!more) return env;

    const name = bail(
      await p.text({
        message: "Env var name the app reads",
        placeholder: "STRIPE_API_KEY",
        validate: (v) => (v?.trim() ? undefined : "Name it, or answer no to the previous question."),
      }),
    ).trim();

    const source = bail(
      await p.select({
        message: `Where does ${name}'s value come from?`,
        options: [
          {
            value: "secret",
            label: "Paste the value",
            hint: "stored in the gitignored externals.local.json — never committed",
          },
          {
            value: "from-env",
            label: "Read it from a shell env var",
            hint: "the recipe commits the variable NAME, not the value",
          },
          {
            value: "inline",
            label: "Paste a NON-SECRET value inline",
            hint: "written into the committed recipe.json as typed",
          },
          { value: "remove", label: "Remove this variable" },
        ],
      }),
    );

    if (source === "remove") {
      env[name] = null;
      continue;
    }
    if (source === "from-env") {
      const varName = bail(
        await p.text({
          message: "Name of the shell variable to read",
          placeholder: "MY_STRIPE_KEY",
          validate: (v) => (v?.trim() ? undefined : "Name the variable."),
        }),
      ).trim();
      env[name] = { valueFromEnv: varName };
      continue;
    }
    const value = bail(
      await p.password({
        message: source === "inline" ? `${name} (committed as typed)` : `${name} (stored locally)`,
        validate: (v) => (v?.trim() ? undefined : "Empty — nothing to store."),
      }),
    );
    env[name] = source === "inline" ? { value, inline: true } : { value };
  }
}

/** How a value's storage reads in the summary — a pasted secret only ever masked. */
function describeSource(source: GuardExternalEnvPatch): string {
  if (source === null) return "removed";
  if ("valueFromEnv" in source) return `$${source.valueFromEnv} (read from your shell env)`;
  if ("inline" in source && source.inline) return `${mask(source.value)} (inline, committed)`;
  return `${mask(source.value)} (stored in externals.local.json)`;
}

/** `••••` plus the last four characters — enough to recognize, never enough to use. */
function mask(value: string): string {
  return value.length > 4 ? `••••${value.slice(-4)}` : "••••";
}

/** Apply the patch and report the service's resulting state, refusals included. */
function write(
  repoRoot: string,
  service: string,
  patch: GuardExternalPatch | null,
  verb: "saved" | "removed",
): void {
  let view: GuardExternalsView;
  try {
    view = writeGuardExternals(repoRoot, { externals: { [service]: patch } });
  } catch (e) {
    if (e instanceof GuardExternalsWriteError) {
      p.log.error(e.message);
      p.outro("Nothing was written.");
      process.exit(1);
    }
    throw e;
  }

  const after = view.services.find((s) => s.service === service);
  if (verb === "removed" || !after) {
    p.log.success(`${service} removed from ${view.recipePath}`);
    p.outro("Its flows go back to blocked at the next generate.");
    return;
  }

  p.log.success(`${service} ${after.state}`);
  p.log.message(`    ${serviceLine(after)}`);
  if (after.state !== "provided") {
    p.log.warn(
      after.state === "incomplete"
        ? "Incomplete — a guard run stops rather than call a half-configured service:"
        : "Nothing resolves yet, so its flows stay blocked:",
    );
    for (const line of unmet(after)) p.log.message(`    ${line}`);
  }
  if (after.undeclaredLocalEnv.length > 0) {
    p.log.warn(
      `Local overlay keys ${service} never declares (ignored): ${after.undeclaredLocalEnv.join(", ")}`,
    );
  }
  p.outro(
    after.state === "provided"
      ? "Run `truecourse guard generate` — flows blocked on it are re-authored against the live service."
      : "Re-run `truecourse guard externals` once you have the rest.",
  );
}
