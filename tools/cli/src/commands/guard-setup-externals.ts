/**
 * The INTERACTIVE half of `truecourse guard setup`'s step 3 — handing guard a real or
 * sandbox account for a third party the app talks to.
 *
 * It lived in `truecourse guard externals` until that command was demoted to a
 * read-only view. It belongs HERE because DECLARING a service is what enters the
 * recipe fingerprint and re-authors the sections it used to block: doing it in the
 * preparation stage is free, doing it after a generate costs a regenerate. (Supplying
 * the VALUE is fingerprint-neutral wherever it happens — which is exactly why setup
 * declares every detected service up front even with no account behind it.)
 *
 * The SECRECY split is what the prompts must make obvious — a pasted value goes to the
 * gitignored `externals.local.json`, a shell variable NAME and an explicitly-inline
 * value go to the committed `recipe.json` — so each source option says where it lands
 * before it is chosen. A secret is never echoed: it is typed into a clack password
 * prompt and read back only as `••••` + its last four characters.
 *
 * Prompts only. Every write goes through core's `writeGuardExternals`, which owns the
 * split and the whole-recipe re-validation.
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
import { serviceLine } from "./guard-externals.js";

/** Every prompt goes through this: a cancel leaves what is already written alone. */
function bail<T>(value: T | symbol): T | null {
  return p.isCancel(value) ? null : (value as T);
}

/**
 * Offer to provision the services that still have no account, one at a time, until
 * the user stops. Returns having written whatever was confirmed — a cancel or a
 * decline simply stops, because everything setup already did is real and committed.
 */
export async function provisionExternals(repoRoot: string): Promise<void> {
  for (;;) {
    const view = readGuardExternalsView(repoRoot);
    // An unreadable recipe is the only reason to stand down: without one there is no
    // declaration half to write into. The absence of an `api` block is NOT a reason —
    // an external service is a dependency of the program, not of the api driver, so a
    // cli-only repo provisions accounts exactly like any other.
    if (!view.recipeValid) return;
    const pending = view.services.filter((s) => s.state !== "provided");
    if (pending.length === 0) {
      p.log.message("  every declared external API has an account — nothing to provide");
      return;
    }

    const more = bail(
      await p.confirm({
        message: `${pending.length} external API${pending.length === 1 ? " has" : "s have"} no account yet. Provide one now?`,
        initialValue: false,
      }),
    );
    if (more !== true) return;
    if ((await provisionOne(repoRoot, view, pending)) === "stop") return;
  }
}

async function provisionOne(
  repoRoot: string,
  view: GuardExternalsView,
  pending: readonly GuardExternalServiceView[],
): Promise<"continue" | "stop"> {
  const choice = bail(
    await p.select({
      message: "Which service?",
      options: [
        ...pending.map((s) => ({ value: s.service, label: s.service, hint: serviceHint(s) })),
        { value: "\0new", label: "Add a service manually", hint: "one TrueCourse cannot see" },
      ],
    }),
  );
  if (choice === null) return "stop";

  const existing = view.services.find((s) => s.service === choice) ?? null;
  let service = choice;
  if (choice === "\0new") {
    const named = bail(
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
    );
    if (named === null) return "stop";
    service = named.trim();
  }

  const baseUrlEnv = bail(
    await p.text({
      message: "Env var your app reads this service's base URL from",
      placeholder: "STRIPE_BASE_URL",
      ...(existing?.baseUrlEnv ? { initialValue: existing.baseUrlEnv } : {}),
      validate: (v) => (v?.trim() ? undefined : "Required — it is the variable the runner sets."),
    }),
  );
  if (baseUrlEnv === null) return "stop";
  if (existing?.baseUrlEnvSource === "detected") {
    p.log.message("  (pre-filled from the code — TrueCourse saw the app read this variable)");
  }
  // A vendor reached through several hosts has one override variable per host.
  // The first is the field above; the rest are asked for below as endpoints —
  // each is a base URL, so it is declared as one and gets its own proxy, rather than
  // being smuggled through the env loop as a key-shaped row.
  const extraBaseUrlEnvs = (existing?.baseUrlEnvs ?? []).filter((e) => e.envVar !== baseUrlEnv.trim());
  if (extraBaseUrlEnvs.length > 0) {
    p.log.message(
      `  also detected as base-URL overrides: ${extraBaseUrlEnvs
        .map((e) => (e.defaultUrl ? `${e.envVar} (today ${e.defaultUrl})` : e.envVar))
        .join(", ")} — each is asked for below as its own base URL`,
    );
  }

  const baseUrl = bail(
    await p.text({
      message: "Base URL of the account (committed — an origin is not a secret)",
      placeholder: "https://api.sandbox.stripe.com",
      ...(existing?.baseUrl ? { initialValue: existing.baseUrl } : {}),
      defaultValue: "",
    }),
  );
  if (baseUrl === null) return "stop";

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
  if (mode === null) return "stop";

  const description = bail(
    await p.text({
      message: "Description (optional)",
      placeholder: "test-mode account, no live charges",
      ...(existing?.description ? { initialValue: existing.description } : {}),
      defaultValue: "",
    }),
  );
  if (description === null) return "stop";

  const endpoints = await collectEndpoints(existing, extraBaseUrlEnvs);
  if (endpoints === null) return "stop";
  const env = await collectEnvVars(existing);
  if (env === null) return "stop";

  // The summary is the LAST place a value could leak — every one of them is masked.
  const lines = [
    `service     ${service}`,
    `base url    ${baseUrl.trim() || "(none — the service stays unprovided)"}`,
    `url env     ${baseUrlEnv.trim()}`,
    ...(mode ? [`mode        ${mode}`] : []),
    ...(description.trim() ? [`about       ${description.trim()}`] : []),
    ...Object.entries(endpoints).map(
      ([name, url]) => `endpoint    ${name} → ${url === null ? "removed" : url}`,
    ),
    ...Object.entries(env).map(([name, source]) => `env         ${name} → ${describeSource(source)}`),
  ];
  p.note(lines.join("\n"), "About to write");

  const go = bail(await p.confirm({ message: "Write it?", initialValue: true }));
  if (go !== true) {
    p.log.info("Nothing written for that service.");
    return "continue";
  }

  return write(repoRoot, service, {
    baseUrlEnv: baseUrlEnv.trim(),
    ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
    ...(mode === "sandbox" || mode === "real" ? { mode } : {}),
    ...(description.trim() ? { description: description.trim() } : {}),
    ...(Object.keys(endpoints).length > 0 ? { endpoints } : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
  });
}

/** The select-list hint: the state plus the reason it matters (blocked flows). */
function serviceHint(s: GuardExternalServiceView): string {
  const parts: string[] = [s.declared ? s.state : "unprovided"];
  if (!s.declared) parts.push("not declared");
  if (s.blockedFlows > 0) parts.push(`${s.blockedFlows} blocked flow${s.blockedFlows === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/**
 * The EXTRA base-URL variables of a service — one origin each, committed.
 * Detected variables the declaration does not carry yet are offered with today's
 * default URL pre-filled; already-declared ones are offered for re-entry.
 */
async function collectEndpoints(
  existing: GuardExternalServiceView | null,
  suggested: readonly { envVar: string; defaultUrl?: string }[],
): Promise<Record<string, string | null> | null> {
  const endpoints: Record<string, string | null> = {};
  const declared = existing?.endpoints ?? {};
  const queue = [
    ...Object.entries(declared).map(([envVar, url]) => ({ envVar, defaultUrl: url })),
    ...suggested.filter((e) => !(e.envVar in declared)),
  ];
  if (queue.length === 0) return endpoints;

  p.log.message(
    "  extra base URLs: the runner proxies each one, so faults can be scripted against the whole service",
  );
  for (const next of queue) {
    const add = bail(
      await p.confirm({
        message: `${next.envVar} — another base URL this service is reached through. Set it?`,
        initialValue: true,
      }),
    );
    if (add === null) return null;
    if (!add) {
      // Declining a DECLARED endpoint drops it; declining a suggestion just skips it.
      if (next.envVar in declared) endpoints[next.envVar] = null;
      continue;
    }
    const url = bail(
      await p.text({
        message: `Base URL for ${next.envVar} (committed — an origin is not a secret)`,
        ...(next.defaultUrl ? { initialValue: next.defaultUrl } : {}),
        validate: (v) =>
          /^https?:\/\/\S+$/.test((v ?? "").trim()) ? undefined : "An absolute http(s) URL.",
      }),
    );
    if (url === null) return null;
    endpoints[next.envVar] = url.trim();
  }
  return endpoints;
}

/** The "add another env var?" loop — name, then WHERE its value lives. */
async function collectEnvVars(
  existing: GuardExternalServiceView | null,
): Promise<Record<string, GuardExternalEnvPatch> | null> {
  const env: Record<string, GuardExternalEnvPatch> = {};
  const declared = (existing?.requirements ?? []).filter((r) => r.kind === "env");
  if (declared.length > 0) {
    p.log.message(
      `  already declared: ${declared
        .map((r) => `${r.envVar} (${r.resolved ? "set" : (r.reason ?? "unresolved")})`)
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
    if (more === null) return null;
    if (!more) return env;

    const name = bail(
      await p.text({
        message: "Env var name the app reads",
        placeholder: "STRIPE_API_KEY",
        validate: (v) => (v?.trim() ? undefined : "Name it, or answer no to the previous question."),
      }),
    );
    if (name === null) return null;

    const source = bail(
      await p.select({
        message: `Where does ${name.trim()}'s value come from?`,
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
    if (source === null) return null;

    if (source === "remove") {
      env[name.trim()] = null;
      continue;
    }
    if (source === "from-env") {
      const varName = bail(
        await p.text({
          message: "Name of the shell variable to read",
          placeholder: "MY_STRIPE_KEY",
          validate: (v) => (v?.trim() ? undefined : "Name the variable."),
        }),
      );
      if (varName === null) return null;
      env[name.trim()] = { valueFromEnv: varName.trim() };
      continue;
    }
    const value = bail(
      await p.password({
        message: source === "inline" ? `${name.trim()} (committed as typed)` : `${name.trim()} (stored locally)`,
        validate: (v) => (v?.trim() ? undefined : "Empty — nothing to store."),
      }),
    );
    if (value === null) return null;
    env[name.trim()] = source === "inline" ? { value, inline: true } : { value };
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
function write(repoRoot: string, service: string, patch: GuardExternalPatch): "continue" | "stop" {
  let view: GuardExternalsView;
  try {
    view = writeGuardExternals(repoRoot, { externals: { [service]: patch } });
  } catch (e) {
    if (e instanceof GuardExternalsWriteError) {
      // A refused write is a refused write, not a failed setup: everything the stage
      // already did is real, so it is reported and the loop stops.
      p.log.error(e.message);
      return "stop";
    }
    throw e;
  }

  const after = view.services.find((s) => s.service === service);
  if (!after) {
    p.log.success(`${service} written to ${view.recipePath}`);
    return "continue";
  }
  p.log.success(`${service} ${after.state}`);
  p.log.message(`    ${serviceLine(after)}`);
  if (after.state !== "provided") {
    p.log.warn(
      after.state === "incomplete"
        ? "Incomplete — a guard run stops rather than call a half-configured service:"
        : "Nothing resolves yet, so its flows stay blocked:",
    );
    for (const r of after.requirements.filter((req) => !req.resolved)) {
      p.log.message(`    ${r.envVar}: ${r.reason ?? "unresolved"}`);
    }
  }
  if (after.undeclaredLocalEnv.length > 0) {
    p.log.warn(
      `Local overlay keys ${service} never declares (ignored): ${after.undeclaredLocalEnv.join(", ")}`,
    );
  }
  return "continue";
}
