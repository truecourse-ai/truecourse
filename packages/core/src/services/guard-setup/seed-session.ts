/**
 * THE SEED AUTHORING SESSION — `guard-setup.seed` (plan 03 step 13).
 *
 * Replaces the one-shot `draftSeed`: the biggest artifact of setup is now
 * PROVED BY EXECUTION while it is being written. The engine's seed step keeps
 * the gate and the replace-confirmation; this seam owns everything after:
 *
 *  - the WORLD: `api.services.up` is booted ONCE before the session and the
 *    session iterates against the LIVE database; teardown always runs;
 *  - the TOOLS: `run_seed_draft` writes the draft to the session's SCRATCH
 *    directory — never the repository's final path — and runs it with the
 *    real `runSeed` (GUARD_SEED_OUT + the default server's env), validating
 *    the manifest against the provides passed IN THE SAME CALL: the
 *    validator-as-tool pattern WITH execution. `db_query` is SELECT-only
 *    introspection of the session's own database; `check_provides` is the
 *    free static half.
 *  - the FOLD (the only repo writes): `writeSeedArtifacts` (script file +
 *    the `api.seed` patch, whole-recipe re-validated), THEN the done-gate —
 *    a FRESH world (`services.down` → `up`), the real `runSeed`, manifest
 *    validation. A gate failure restores both files byte-for-byte and the
 *    outcome is refused: the step fails with the SeedError, setup does not.
 *
 * SCRATCH LIVES INSIDE THE TREE, deliberately: `.truecourse/.cache/guard/
 * seed-drafts/<id>/` (gitignored wholesale via `.cache/`, deleted after the
 * session). A draft must import the app's own ORM, and Node resolves bare
 * specifiers from the IMPORTING FILE's directory upward — a draft in the OS
 * tmpdir would fail every import and prove nothing. What "never the repo"
 * protects — no draft at a committed path until the fold — still holds.
 *
 * SECRET HYGIENE: every tool result passes `buildCredentialRedactor` before
 * it enters the transcript. The redactor grows as the session mints values —
 * each `run_seed_draft`'s manifest credentials are harvested into it — so a
 * later `db_query` that SELECTs a token back cannot leak it either.
 *
 * CACHE: author-class. KEEPS the `guard/seed` name; the key is the seed
 * step's own input fingerprint (recipe ∷ dependency catalog) + the prompt
 * fingerprint. The fresh-world PROOF always re-runs on hits — a cached script
 * is a draft to re-prove, never a proof.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { z } from 'zod';
import {
  defineSessionTool,
  type SessionDef,
  type SessionEvent,
  type SessionTool,
  type SessionToolResult,
} from '@truecourse/agent-loop';
import {
  SEED_CACHE_NAME,
  SeedProvidesProposalSchema,
  buildSeedUserPrompt,
  connectionEnvVars,
  suggestedScriptPath,
  toRecipeSeed,
  writeSeedArtifacts,
  type GuardSetupSeedSession,
  type GuardSetupSeedSessionInput,
  type RecipeEcosystem,
  type SeedProvidesProposal,
} from '@truecourse/guard-generator';
import {
  DEFAULT_BUILD_TIMEOUT_MS,
  SeedError,
  buildCredentialRedactor,
  guardSetupFindingsPath,
  loadDependencyCatalog,
  preflightApiServer,
  recipePath,
  resolveApiServers,
  resolveEntry,
  runBuild,
  runSeed,
  type Recipe,
  type ResolvedApiServer,
  type ResolvedCredential,
} from '@truecourse/guard-runner';
import { cachedSessionOutcome, promptFingerprint } from '../agent/session-cache.js';
import { appendFindingsLedger } from '../agent/findings-ledger.js';
import { runSessionPool } from '../agent/session-pool.js';
import { readFileTool, searchTool } from '../interface-author/tools.js';
import { describeSessionFailure, type GuardSetupSessionContext } from './session-context.js';

export const SEED_SESSION_KIND = 'guard-setup.seed';

/** The three numbers (§3.3): a seed is written, RUN, read back, and revised —
 *  each `run_seed_draft` is a whole execute-and-validate cycle, and a schema
 *  worth seeding usually takes a few. 20 turns covers write→run→fix→run→done
 *  with introspection between. */
export const SEED_SESSION_BUDGET = { turns: 20, maxResumes: 1, tokenCeiling: 200_000 } as const;

/** How much of a command's output one tool result carries; tails kept — that
 *  is where a failed insert states its constraint. */
const MAX_TOOL_OUTPUT_CHARS = 10_000;
/** Wall clock for one `db_query` client spawn. */
const DB_QUERY_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// The outcome
// ---------------------------------------------------------------------------

/**
 * One live-probe declaration per minted credential: an endpoint that REQUIRES
 * the credential, so the verify can make a real authenticated request instead
 * of trusting the manifest's shape (2026-08-23 bench: a `Bearer `-prefixed
 * token passed every static check and would have 401'd at guard run).
 * Session-side verification only — probes never enter the committed recipe.
 */
export const SeedCredentialProbeSchema = z
  .object({
    /** HTTP method; GET when omitted. */
    method: z.string().min(1).optional(),
    /** Request path (starts with `/`) of an endpoint that requires the credential. */
    path: z.string().min(1).regex(/^\//, 'a probe path starts with `/`'),
  })
  .strict();
export type SeedCredentialProbe = z.infer<typeof SeedCredentialProbeSchema>;

/**
 * `findings` is REQUIRED (empty array fine), not `.default([])` — a default
 * gives the schema a different input than output type, which `SessionDef`'s
 * `z.ZodType<TOutcome>` refuses (same rule as the catalog draft).
 */
export const SeedSessionOutcomeSchema = z
  .object({
    /** The script's full source text — the fold writes it at the target path. */
    script: z.string().min(1),
    /** One shell command, repo root, that runs the script AT THE TARGET PATH. */
    command: z.string().min(1),
    provides: SeedProvidesProposalSchema,
    /** Required (by the fold) for every declared credential; see the probe schema. */
    probes: z.record(z.string(), SeedCredentialProbeSchema).optional(),
    findings: z.array(z.string()),
  })
  .strict();
export type SeedSessionOutcome = z.infer<typeof SeedSessionOutcomeSchema>;

/** `sha256(prompt fp :: the seed step's input fingerprint)` — the step
 *  fingerprint already folds the recipe and the committed catalog. */
export function seedSessionCacheKey(stepFingerprint: string): string {
  return createHash('sha256')
    .update(`${promptFingerprint(SYSTEM_PROMPT)}::${stepFingerprint}`)
    .digest('hex');
}

/**
 * The path the fold writes the script to — the recipe's declared
 * `api.seed.script` when one is being replaced (an edit stays an edit),
 * else the plan's convention under the committed scenarios directory.
 */
export function seedScriptTargetPath(input: {
  existingScript?: { scriptPath: string };
  ecosystem: string;
}): string {
  if (input.existingScript) return input.existingScript.scriptPath;
  const suggested = suggestedScriptPath(input.ecosystem as RecipeEcosystem);
  return `.truecourse/scenarios/${path.basename(suggested)}`;
}

// ---------------------------------------------------------------------------
// The static check (`check_provides`)
// ---------------------------------------------------------------------------

/** The warnings the fold cannot enforce but a drafter should hear for one
 *  turn's cost — shape problems that become silent 401s at run time. */
export function providesWarnings(
  provides: SeedProvidesProposal,
  input: Pick<GuardSetupSeedSessionInput, 'securitySchemes' | 'roles'>,
): string[] {
  const warnings: string[] = [];
  const known = new Set(input.securitySchemes.map((s) => s.name));
  const credentials = Object.entries(provides.credentials ?? {});
  for (const [name, cred] of credentials) {
    if (cred.satisfies !== undefined && !known.has(cred.satisfies)) {
      warnings.push(
        `credential "${name}" satisfies "${cred.satisfies}", which is not a declared security scheme — the write path DROPS an unknown \`satisfies\` (declared: ${[...known].join(', ') || '(none)'})`,
      );
    }
    if (cred.header.toLowerCase() === 'authorization') {
      warnings.push(
        `credential "${name}" is injected as the Authorization header — its manifest value must carry the full header value (e.g. \`Bearer <token>\`); the runner adds no prefix`,
      );
    }
  }
  if (credentials.length === 0 && input.securitySchemes.length > 0) {
    warnings.push(
      'no credentials declared while the API declares security schemes — omit credentials only when the API truly has no authentication',
    );
  }
  if (input.roles.length > 0 && credentials.length < input.roles.length) {
    warnings.push(
      `${input.roles.length} role(s) were detected (${input.roles.map((r) => r.name).join(', ')}) but only ${credentials.length} credential(s) are declared — the doctrine is one principal per role`,
    );
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

interface SeedSessionWorld {
  input: GuardSetupSeedSessionInput;
  server: ResolvedApiServer;
  /** Repo-relative path the FOLD will write the script to. */
  targetPath: string;
  /** Absolute scratch dir the drafts run from (inside `.truecourse/.cache/`). */
  scratchDir: string;
  /** The security-scheme names a `satisfies` may keep. */
  knownSchemes: ReadonlySet<string>;
  /** Grows as drafts mint values; every tool result is passed through it. */
  secrets: Map<string, string>;
  /**
   * The last draft `run_seed_draft` FULLY verified (seed ran, manifest matched,
   * probes passed when credentials are declared). When the session dies without
   * an outcome, this is folded in its place — the engine already ran it, so
   * discarding it repeats the 2026-08-23 incident (a proven draft thrown away
   * at budget exhaustion). The fresh-world proof still gates the write.
   */
  lastVerified?: Pick<SeedSessionOutcome, 'script' | 'command' | 'provides' | 'probes'>;
  /** Set when the fold consumed `lastVerified` instead of a session outcome. */
  salvaged?: boolean;
  signal?: AbortSignal;
}

export function seedSessionDef(world: SeedSessionWorld): SessionDef<SeedSessionOutcome> {
  return {
    kind: SEED_SESSION_KIND,
    systemPrompt: SYSTEM_PROMPT,
    tools: buildSeedTools(world),
    outcomeSchema: SeedSessionOutcomeSchema,
    budget: SEED_SESSION_BUDGET,
    // Prove-by-execution, structurally: an outcome produced before the draft
    // ever RAN is an unproven script the fold will most likely refuse minutes
    // later — one turn here is cheaper.
    outcomePrecondition: {
      tool: 'run_seed_draft',
      message:
        'Outcome refused: you never ran `run_seed_draft` in this session. Run it on your complete draft now — it executes the script against the live services and validates its manifest against your `provides`, exactly as the fold will. Fix anything it reports, then call `outcome` again.',
    },
    // The item-118 checkpoint, extended here after the 2026-08-23 bench: two
    // seed sessions spent their entire first grant (20/20 turns) exploring
    // with zero drafts, and only the exhaustion warning forced drafting.
    draftCheckpoint: {
      tool: 'run_seed_draft',
      afterTurn: 10,
      message:
        '[checkpoint] You have spent more than half your first turn grant without running a draft. Write your best current seed script and call `run_seed_draft` NOW — its real execution errors (imports, constraints, enum casing) steer better than more reading. Iterate from the draft; do not return to open-ended exploration.',
    },
  };
}

/** How many seed-machinery files the briefing carries, and how much of each. */
const SEED_MACHINERY_MAX_FILES = 8;
const SEED_MACHINERY_MAX_LINES = 60;
const SEED_MACHINERY_MAX_CHARS = 3_000;
/** Dirs the machinery walk never descends into. */
const SEED_MACHINERY_SKIP = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'vendor', '.next', '.truecourse', '.cache',
]);

/**
 * The repository's own seed files — `seed`-named scripts and directories, the
 * helpers a drafter should REUSE instead of re-deriving (they carry the app's
 * side effects). Briefing material because every session otherwise re-finds
 * them by search: the 2026-08-23 bench spent ~10 turns per session on exactly
 * these reads. Shallowest paths first, capped, excerpted.
 */
export function existingSeedMachinery(repoRoot: string): { path: string; excerpt: string }[] {
  const found: string[] = [];
  const stack = [''];
  while (stack.length > 0 && found.length < 200) {
    const rel = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(repoRoot, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SEED_MACHINERY_SKIP.has(entry.name) && !entry.name.startsWith('.')) stack.push(childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) continue;
      if (!/(^|\/)seeds?([._-]|\/|\.)/i.test(childRel)) continue;
      found.push(childRel);
    }
  }
  found.sort((a, b) => {
    const depth = a.split('/').length - b.split('/').length;
    return depth !== 0 ? depth : a.localeCompare(b);
  });
  return found.slice(0, SEED_MACHINERY_MAX_FILES).map((rel) => {
    let excerpt = '';
    try {
      const lines = fs.readFileSync(path.join(repoRoot, rel), 'utf-8').split('\n');
      excerpt = lines.slice(0, SEED_MACHINERY_MAX_LINES).join('\n');
      if (excerpt.length > SEED_MACHINERY_MAX_CHARS) excerpt = excerpt.slice(0, SEED_MACHINERY_MAX_CHARS);
      if (lines.length > SEED_MACHINERY_MAX_LINES) excerpt += `\n… (${lines.length - SEED_MACHINERY_MAX_LINES} more lines — read_file for the rest)`;
    } catch {
      /* unreadable file: list the path alone */
    }
    return { path: rel, excerpt };
  });
}

/** The opening message: the one-shot draft's grounding (verbatim — the same
 *  schema/route/scheme/role rendering), plus the session-specific facts. */
export function seedSessionBriefing(world: SeedSessionWorld): string {
  const { input } = world;
  const catalog = loadDependencyCatalog(input.repoRoot);
  const grounding = buildSeedUserPrompt({
    driver: input.database.driver,
    databaseType: input.database.type,
    tables: input.database.tables,
    relations: input.database.relations,
    connectionEnv: connectionEnvVars(input.recipe),
    appImports: input.database.appImports,
    blocked: [],
    ...(input.routes.length > 0 ? { routes: input.routes } : {}),
    ...(input.securitySchemes.length > 0 ? { securitySchemes: input.securitySchemes } : {}),
    ...(input.roles.length > 0 ? { roles: input.roles } : {}),
    ...(input.specExcerpts.length > 0 ? { specExcerpts: input.specExcerpts } : {}),
    ...(input.existingScript ? { replacing: input.existingScript } : {}),
    ecosystem: input.ecosystem,
    suggestedPath: world.targetPath,
  });
  const machinery = existingSeedMachinery(input.repoRoot);
  const lines = [
    'Author the ONE seed script this repository needs — the rows AND the authenticated principals its spec-derived tests reference.',
    '',
    `The services are LIVE right now (\`api.services.up\` already ran); your \`run_seed_draft\` calls execute against that world, and \`db_query\` reads its database.`,
    `The fold will write your script to \`${world.targetPath}\` — your \`command\` must run exactly that path from the repository root (during the session, \`run_seed_draft\` substitutes its scratch copy for it).`,
    '',
    '## The dependency catalog (scenarios/dependencies.json)',
    catalog.dependencies.length === 0
      ? '(empty — no entries yet)'
      : catalog.dependencies
          .map((d) => `- ${d.name} · ${d.class} · ${d.summary}`)
          .join('\n'),
    ...(machinery.length > 0
      ? [
          '',
          "## The repository's own seed machinery",
          'These seed files already exist in this repository. REUSE their helpers — they carry the app\'s side effects (hashes, defaults, join rows) — and import them the way the app does; do not re-derive what they already do:',
          ...machinery.map((m) => `### ${m.path}\n${m.excerpt}`),
        ]
      : []),
    '',
    grounding,
    '',
    'Work loop: draft EARLY, iterate from real errors. Read only what the briefing above does not already answer, then `check_provides` for the free shape check and `run_seed_draft` to PROVE the draft (idempotence included: run it twice — the second run against the rows the first left behind is the real test). For every credential you mint, the same call must declare `probes` — per credential, an endpoint that REQUIRES it; the engine sends the minted value verbatim and also checks the same request is refused without it. Then produce the outcome `{script, command, provides, probes, findings}`. `findings` is for code-vs-docs contradictions you established (two named sides, verbatim); usually empty.',
  ];
  return lines.join('\n');
}

function buildSeedTools(world: SeedSessionWorld): SessionTool[] {
  const tools = [
    readFileTool(world.input.repoRoot),
    searchTool(world.input.repoRoot),
    runSeedDraftTool(world),
    dbQueryTool(world),
    checkProvidesTool(world),
  ];
  // EVERY tool result passes the redactor before it enters the transcript —
  // transcripts persist, and minted values must not (plan 03 step 13).
  return tools.map((tool) => redacted(tool, world.secrets));
}

/** Wrap a tool so its result content is redacted with the CURRENT secret set. */
function redacted(tool: SessionTool, secrets: ReadonlyMap<string, string>): SessionTool {
  return {
    ...tool,
    async execute(args, ctx) {
      const result = await tool.execute(args, ctx);
      const redact = buildCredentialRedactor(secrets);
      return { ...result, content: redact(result.content) };
    },
  };
}

const RunSeedDraftInputSchema = z
  .object({
    /** The script's FULL source. Written to scratch, never to the repo. */
    script: z.string().min(1),
    /** The shell command naming the TARGET path — the scratch copy is substituted. */
    command: z.string().min(1),
    /** The provides the manifest is validated against, in the same call. */
    provides: SeedProvidesProposalSchema,
    /** One per declared credential — see {@link SeedCredentialProbeSchema}. */
    probes: z.record(z.string(), SeedCredentialProbeSchema).optional(),
  })
  .strict();

/** Wall clock for one probe request. */
const PROBE_TIMEOUT_MS = 15_000;

/** The declared credential names a `probes` record fails to cover. */
function uncoveredCredentials(
  provides: SeedProvidesProposal,
  probes: Record<string, SeedCredentialProbe> | undefined,
): string[] {
  return Object.keys(provides.credentials ?? {}).filter((name) => !probes?.[name]);
}

/**
 * Prove each minted credential against the LIVE server: the probe request with
 * the credential must not be refused (401/403), and the SAME request without it
 * must be — an endpoint that answers anonymously gates nothing and proves
 * nothing. Values are sent VERBATIM, exactly as the runner will inject them.
 */
async function probeCredentials(opts: {
  baseUrl: string;
  probes: Record<string, SeedCredentialProbe>;
  credentials: ReadonlyMap<string, ResolvedCredential>;
  signal?: AbortSignal;
}): Promise<{ ok: true; lines: string[] } | { ok: false; reason: string }> {
  const lines: string[] = [];
  for (const [name, cred] of opts.credentials) {
    const probe = opts.probes[name];
    if (!probe) continue; // Coverage is the caller's refusal; here we prove what is declared.
    const method = probe.method ?? 'GET';
    const url = new URL(probe.path, opts.baseUrl).toString();
    const request = async (withCredential: boolean): Promise<number> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      const onAbort = (): void => controller.abort();
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const response = await fetch(url, {
          method,
          redirect: 'manual',
          headers: withCredential ? { [cred.header]: cred.value } : {},
          signal: controller.signal,
        });
        return response.status;
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      }
    };
    let authed: number;
    let control: number;
    try {
      authed = await request(true);
      control = await request(false);
    } catch (error) {
      return { ok: false, reason: `probe ${method} ${probe.path} for "${name}" failed: ${message(error)}` };
    }
    if (authed === 401 || authed === 403) {
      return {
        ok: false,
        reason:
          `credential "${name}" was refused (HTTP ${authed}) at ${method} ${probe.path} — the minted value, sent verbatim in the ${cred.header} header, does not authenticate. Fix the value (or its shape: prefix, casing) in the script.`,
      };
    }
    if (control !== 401 && control !== 403) {
      return {
        ok: false,
        reason:
          `probe ${method} ${probe.path} answers HTTP ${control} WITHOUT the credential — it does not gate on auth, so it proves nothing about "${name}". Pick an endpoint that requires it.`,
      };
    }
    lines.push(`${name}: ${method} ${probe.path} → ${authed} with the credential, ${control} without`);
  }
  return { ok: true, lines };
}

/**
 * Boot the recipe's default server once (the same preflight the runner uses)
 * and run the credential probes against it — shared verbatim by the in-session
 * tool and the fold's fresh-world proof, so a draft cannot pass one and fail
 * the other for a different reason.
 */
async function bootAndProbe(
  world: SeedSessionWorld,
  probes: Record<string, SeedCredentialProbe>,
  credentials: ReadonlyMap<string, ResolvedCredential>,
  signal?: AbortSignal,
): Promise<{ ok: true; lines: string[] } | { ok: false; reason: string }> {
  let probed: Awaited<ReturnType<typeof probeCredentials>> | null = null;
  const boot = await preflightApiServer({
    resolvedServe: resolveEntry(world.input.repoRoot, [...world.server.serve]),
    displayServe: world.server.serve,
    ...(world.server.cwd === 'repo' ? { cwd: world.input.repoRoot } : {}),
    recipeEnv: world.server.env,
    healthPath: world.server.healthPath,
    readyTimeoutMs: world.server.readyTimeoutMs,
    ...(signal ? { signal } : {}),
    onReady: async (baseUrl) => {
      probed = await probeCredentials({ baseUrl, probes, credentials, ...(signal ? { signal } : {}) });
    },
  });
  if (!boot.ok) {
    return { ok: false, reason: `the server would not boot for the credential probes: ${boot.stderr || 'unknown'}` };
  }
  return probed ?? { ok: false, reason: 'the server booted but the probes never ran' };
}

function runSeedDraftTool(world: SeedSessionWorld): SessionTool {
  let drafts = 0;
  return defineSessionTool({
    name: 'run_seed_draft',
    description:
      `Execute a seed DRAFT against the live services: the script is written to your scratch directory (never the repository), your command is run from the repository root with GUARD_SEED_OUT and the server env set, and the manifest it writes is validated against the \`provides\` you pass in the SAME call — exactly the validation the fold runs. The command must name the target path \`${world.targetPath}\`; the scratch copy is substituted for it. Returns the verdict and the (redacted) output.`,
    kind: 'run-seed-draft',
    readOnly: false,
    destructive: false,
    inputSchema: RunSeedDraftInputSchema,
    async execute(args, toolCtx) {
      if (!args.command.includes(world.targetPath)) {
        return {
          content: `the command must run the script at its target path \`${world.targetPath}\` (the fold writes it there); got: ${args.command}`,
          isError: true,
        };
      }
      // A minted credential is proven by a LIVE authenticated request, never by
      // its manifest shape — refuse before spending an execution on a draft the
      // fold would refuse anyway.
      const uncovered = uncoveredCredentials(args.provides, args.probes);
      if (uncovered.length > 0) {
        return {
          content:
            `your provides declares credential(s) with no live probe: ${uncovered.join(', ')}. ` +
            `Add \`probes\` to this same call — per credential, an endpoint that REQUIRES it, e.g. ` +
            `{"${uncovered[0]}": {"method": "GET", "path": "/…"}}. The engine sends the minted value verbatim and expects the request to be accepted, and the same request WITHOUT the credential to be refused.`,
          isError: true,
        };
      }
      const draftFile = path.join(world.scratchDir, `draft-${++drafts}${path.extname(world.targetPath) || '.mjs'}`);
      fs.mkdirSync(world.scratchDir, { recursive: true });
      fs.writeFileSync(draftFile, args.script);
      const draftRel = path.relative(world.input.repoRoot, draftFile).split(path.sep).join('/');
      const seed = toRecipeSeed(
        {
          scriptPath: draftRel,
          scriptContent: args.script,
          seed: { command: args.command.split(world.targetPath).join(draftRel), provides: args.provides },
        },
        world.knownSchemes,
      );
      try {
        const result = await runSeed({
          repoRoot: world.input.repoRoot,
          seed,
          env: world.server.env,
          timeoutMs: DEFAULT_BUILD_TIMEOUT_MS,
          knownCredentials: world.secrets,
          ...(toolCtx.signal ? { signal: toolCtx.signal } : {}),
        });
        // Harvest the minted values into the redactor BEFORE composing any
        // content — the summary below names names, never values.
        for (const [name, cred] of result.credentials) {
          if (cred.value.length > 0) world.secrets.set(name, cred.value);
        }
        // The live half of the proof: boot the server once and make one real
        // authenticated request per minted credential (skipped entirely when
        // the draft mints none — nothing to prove, no boot to pay for).
        let probeLines: string[] = [];
        if (result.credentials.size > 0 && args.probes) {
          const probed = await bootAndProbe(world, args.probes, result.credentials, toolCtx.signal);
          if (!probed.ok) {
            return { content: `the seed ran and its manifest matched, but the credential probe refused it:\n${probed.reason}`, isError: true };
          }
          probeLines = probed.lines;
        }
        world.lastVerified = {
          script: args.script,
          command: args.command,
          provides: args.provides,
          ...(args.probes ? { probes: args.probes } : {}),
        };
        const fixtures = [...result.fixtures.entries()]
          .map(([name, fields]) => `${name}{${Object.keys(fields).join(', ')}}`)
          .join(' · ');
        return {
          content:
            `VERIFIED against the live world: the script ran clean and the manifest matched \`provides\`.\n` +
            `credentials minted: ${[...result.credentials.keys()].join(', ') || '(none)'}\n` +
            (probeLines.length > 0 ? `probes passed: ${probeLines.join(' · ')}\n` : '') +
            `fixtures emitted: ${fixtures || '(none)'}\n` +
            `Run it AGAIN to prove idempotence if you have not, then produce the outcome (script + a command naming ${world.targetPath}).`,
        };
      } catch (error) {
        if (error instanceof SeedError) return { content: clip(error.message), isError: true };
        return { content: clip(message(error)), isError: true };
      }
    },
  });
}

const DbQueryInputSchema = z.object({ sql: z.string().min(1) }).strict();

function dbQueryTool(world: SeedSessionWorld): SessionTool {
  return defineSessionTool({
    name: 'db_query',
    description:
      'Run ONE read-only SQL statement (SELECT/WITH only) against the session\'s live database — introspection, not mutation: verify what a draft actually wrote, read an enum\'s real casing, count rows. Mutating statements are refused; state changes go through your seed script, where they are reviewable.',
    kind: 'db-query',
    readOnly: true,
    destructive: false,
    inputSchema: DbQueryInputSchema,
    async execute(args, toolCtx) {
      const head = args.sql.trim().replace(/^\(+/, '').split(/\s+/, 1)[0]?.toUpperCase() ?? '';
      if (head !== 'SELECT' && head !== 'WITH') {
        return {
          content: `only SELECT/WITH statements run here — got \`${head || '(empty)'}\`. State changes belong in the seed script.`,
          isError: true,
        };
      }
      const client = resolveDbClient(world);
      if ('unavailable' in client) return { content: client.unavailable, isError: true };
      return await new Promise<SessionToolResult>((resolve) => {
        execFile(
          client.argv[0],
          [...client.argv.slice(1), args.sql],
          {
            timeout: DB_QUERY_TIMEOUT_MS,
            env: { ...process.env, ...world.server.env },
            ...(toolCtx.signal ? { signal: toolCtx.signal } : {}),
          },
          (error, stdout, stderr) => {
            if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
              resolve({
                content: `\`${client.argv[0]}\` is not installed on this machine — introspect through \`run_seed_draft\` (a draft can print what it reads) instead.`,
                isError: true,
              });
              return;
            }
            const body = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
            resolve(
              error
                ? { content: clip(body || message(error)), isError: true }
                : { content: clip(body || '(no rows)') },
            );
          },
        );
      });
    },
  });
}

/**
 * The client argv a `db_query` spawns, per datastore family — the sql rides as
 * the LAST argument (appended by the caller). Best-effort, honestly bounded:
 * a family with no ubiquitous CLI reports itself unavailable rather than
 * pretending, and the session still has `run_seed_draft` to observe with.
 */
function resolveDbClient(world: SeedSessionWorld): { argv: string[] } | { unavailable: string } {
  const type = world.input.database.type.toLowerCase();
  const url = connectionUrl(world);
  if (type.includes('postgres')) {
    if (!url) return { unavailable: 'no connection URL found in the recipe env — cannot point psql at the database' };
    return { argv: ['psql', url, '-X', '-v', 'ON_ERROR_STOP=1', '-P', 'pager=off', '-c'] };
  }
  if (type.includes('sqlite')) {
    const file = url?.replace(/^(sqlite:\/\/|sqlite:|file:)/, '');
    if (!file) return { unavailable: 'no sqlite file path found in the recipe env' };
    return { argv: ['sqlite3', '-readonly', path.resolve(world.input.repoRoot, file)] };
  }
  if (type.includes('mysql') || type.includes('maria')) {
    if (!url) return { unavailable: 'no connection URL found in the recipe env — cannot point mysql at the database' };
    return { argv: ['mysql', `--connect-timeout=10`, `--protocol=tcp`, url, '-e'] };
  }
  return {
    unavailable: `no query client is wired for a ${world.input.database.type} datastore — introspect through \`run_seed_draft\` instead`,
  };
}

/** The first connection-shaped value of the server env (the env the app — and
 *  every draft run — actually reads). Values stay in-process; only the spawn
 *  sees them. */
function connectionUrl(world: SeedSessionWorld): string | null {
  const names = connectionEnvVars(world.input.recipe);
  for (const name of names) {
    const value = world.server.env[name];
    if (value) return value;
  }
  for (const value of Object.values(world.server.env)) {
    if (/^(postgres(ql)?|mysql|sqlite|file):/.test(value)) return value;
  }
  return null;
}

function checkProvidesTool(world: SeedSessionWorld): SessionTool {
  return defineSessionTool({
    name: 'check_provides',
    description:
      'Statically check a `provides` declaration — the shape (enforced on the arguments) plus the credential-shape warnings the run-time surfaces would otherwise raise as silent 401s. Free; `run_seed_draft` is the real proof.',
    kind: 'check-provides',
    readOnly: true,
    destructive: false,
    inputSchema: SeedProvidesProposalSchema,
    async execute(args) {
      const warnings = providesWarnings(args, world.input);
      if (warnings.length === 0) {
        return { content: 'The declaration is statically clean. Prove it with `run_seed_draft`.' };
      }
      return { content: `${warnings.length} warning(s):\n- ${warnings.join('\n- ')}` };
    },
  });
}

// ---------------------------------------------------------------------------
// The seam implementation the engine's seed step calls
// ---------------------------------------------------------------------------

export interface BuildSeedSessionOptions {
  signal?: AbortSignal;
  onSessionEvent?: (workItem: string, event: SessionEvent) => void;
}

/** One `api.services` lifecycle handle — up/down through `runBuild`, exactly
 *  as `verifyProposal` runs them, teardown always safe to call twice. */
function servicesController(repoRoot: string, recipe: Recipe, signal?: AbortSignal) {
  const services = recipe.api?.services;
  let up = false;
  return {
    async up(): Promise<void> {
      if (!services) return;
      const result = await runBuild(repoRoot, services.up, recipe.env, DEFAULT_BUILD_TIMEOUT_MS, signal);
      if (!result.ok) {
        throw new Error(
          `\`${services.up}\` failed${result.timedOut ? ' (timed out)' : ''}: ${tail(result.output)}`,
        );
      }
      up = true;
    },
    async down(): Promise<void> {
      if (!services?.down || !up) return;
      up = false;
      await runBuild(repoRoot, services.down, recipe.env, DEFAULT_BUILD_TIMEOUT_MS);
    },
  };
}

/**
 * The `GuardSetupSeedSession` the command adapter injects. One session,
 * concurrency 1. The fold runs here after the outcome — on cache hits too,
 * where the fresh-world proof is exactly what makes a stale cached script
 * refuse itself instead of landing.
 */
export function buildSeedSession(
  context: GuardSetupSessionContext,
  opts: BuildSeedSessionOptions = {},
): GuardSetupSeedSession {
  return async (input) => {
    const resolved = resolveApiServers(input.recipe);
    const server = resolved.servers.get(resolved.defaultServer);
    if (!server) {
      return { status: 'failed', reason: 'the recipe declares no api server to run the seed against' };
    }
    const targetPath = seedScriptTargetPath(input);
    const scratchDir = path.join(
      input.repoRoot,
      '.truecourse',
      '.cache',
      'guard',
      'seed-drafts',
      randomUUID().slice(0, 8),
    );
    const world: SeedSessionWorld = {
      input,
      server,
      targetPath,
      scratchDir,
      knownSchemes: new Set(input.securitySchemes.map((s) => s.name)),
      secrets: new Map(),
      ...(opts.signal ? { signal: opts.signal } : {}),
    };
    const services = servicesController(input.repoRoot, input.recipe, opts.signal);

    // The app is BUILT before anything here boots it: the session's and the
    // fold's credential probes both start the recipe's server, and a checkout
    // that never ran `recipe.build` has nothing to boot (2026-08-24 bench,
    // cal.diy: draft verified, probe dead on a missing dist — unfixable from
    // inside the session on a heavy-build repo). Once, outside the session
    // cache, so a cache hit's fold probe gets a built app too; the fold's
    // fresh world resets the datastore, never the app binary.
    if (input.recipe.build) {
      input.onPhase?.(`building the app (\`${input.recipe.build}\`)`, 'build');
      const built = await runBuild(
        input.repoRoot,
        input.recipe.build,
        input.recipe.env,
        DEFAULT_BUILD_TIMEOUT_MS,
        opts.signal,
      );
      if (!built.ok) {
        return {
          status: 'failed',
          reason: `the recipe \`build\` failed${built.timedOut ? ' (timed out)' : ''}: ${tail(built.output)}`,
        };
      }
    }

    try {
      const outcome = await cachedSessionOutcome<SeedSessionOutcome>({
        repoRoot: input.repoRoot,
        cacheName: SEED_CACHE_NAME,
        key: seedSessionCacheKey(input.fingerprint),
        schema: SeedSessionOutcomeSchema,
        run: async () => {
          const { driver, persistence } = await context.acquire();
          // The session's world: ONE boot, before the first turn; the fold
          // rebuilds a fresh one for the proof, and the finally below tears
          // down whatever is still standing.
          input.onPhase?.(`starting the services (\`${input.recipe.api?.services?.up ?? 'none declared'}\`)`, 'services up');
          await services.up();
          try {
            input.onPhase?.('the seed session is drafting against the live services', 'seed session');
            const results = await runSessionPool<GuardSetupSeedSessionInput, SeedSessionOutcome>({
              items: [input],
              workItem: () => 'seed',
              session: () => seedSessionDef(world),
              briefing: () => [seedSessionBriefing(world)],
              driver,
              persistence,
              concurrency: 1,
              ...(opts.signal ? { signal: opts.signal } : {}),
              ...(opts.onSessionEvent ? { onSessionEvent: opts.onSessionEvent } : {}),
              fold: () => {
                /* single item; the seam folds below, after cache accounting */
              },
            });
            const result = results[0]?.outcome;
            if (!result) {
              return {
                status: 'failed',
                failure: {
                  kind: 'transport',
                  detail: 'aborted before the session started',
                  class: 'unknown',
                  retryability: 'none',
                },
                resumable: false,
                spent: { turns: 0, tokens: 0, costUsd: 0 },
              };
            }
            context.note(result.status);
            context.addSpend(1, result.spent);
            // SALVAGE: a session that died (budget exhausted, malformed, a dead
            // provider) while holding a draft `run_seed_draft` FULLY verified is
            // not a lost session — the tool already ran that draft against the
            // live world, and its args are exactly the outcome's shape. Fold the
            // verified draft; the fresh-world proof below still gates the write.
            // Never on an abort: a cancelled run writes nothing.
            if (result.status !== 'completed' && world.lastVerified && !opts.signal?.aborted) {
              world.salvaged = true;
              return {
                status: 'completed',
                output: { ...world.lastVerified, findings: [] },
                pendingQuestions: [],
                spent: result.spent,
              };
            }
            return result;
          } finally {
            await services.down();
          }
        },
      });
      const sessionRunId = context.runId();
      if (outcome.status !== 'completed') {
        return {
          status: 'failed',
          reason: describeSessionFailure(outcome.failure),
          ...(sessionRunId ? { sessionRunId } : {}),
        };
      }

      const folded = await foldSeedOutcome(world, services, outcome.output);
      if ('reason' in folded) {
        return { status: 'failed', reason: folded.reason, ...(sessionRunId ? { sessionRunId } : {}) };
      }
      if (!outcome.fromCache && outcome.output.findings.length > 0) {
        appendFindingsLedger({
          repoRoot: input.repoRoot,
          ledgerPath: guardSetupFindingsPath(input.repoRoot),
          runId: sessionRunId ?? 'guard-setup',
          findings: [{ workItem: 'seed', lines: outcome.output.findings }],
          preamble:
            '# Guard setup findings\n\nCode-vs-docs discrepancies the setup sessions read. Append-only; one section per run.\n\n',
        });
      }
      return {
        status: 'ok',
        scriptPath: targetPath,
        command: outcome.output.command,
        ...(folded.fixtures.length > 0 ? { fixtures: folded.fixtures } : {}),
        ...(folded.credentials.length > 0 ? { credentials: folded.credentials } : {}),
        ...(sessionRunId ? { sessionRunId } : {}),
        ...(outcome.fromCache ? { fromCache: true } : {}),
        ...(world.salvaged ? { salvaged: true } : {}),
      };
    } catch (error) {
      return {
        status: 'failed',
        reason: message(error),
        ...(context.runId() ? { sessionRunId: context.runId() } : {}),
      };
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  };
}

/**
 * THE FOLD: write the two artifacts, then the done-gate — a fresh world and
 * the real `runSeed` — restoring the tree byte-for-byte when the gate refuses.
 */
async function foldSeedOutcome(
  world: SeedSessionWorld,
  services: ReturnType<typeof servicesController>,
  output: SeedSessionOutcome,
): Promise<{ fixtures: string[]; credentials: string[] } | { reason: string }> {
  const { input, targetPath } = world;
  if (!output.command.includes(targetPath)) {
    return {
      reason: `the outcome's command does not run the target script \`${targetPath}\`: ${output.command}`,
    };
  }
  // A credential without a live probe is unproven — the same rule
  // `run_seed_draft` applies, re-checked here because the outcome's probes are
  // what the fresh-world proof runs (a session could verify with probes and
  // then drop them from the outcome).
  const unprobed = uncoveredCredentials(output.provides, output.probes);
  if (unprobed.length > 0) {
    return {
      reason:
        `the outcome declares credential(s) with no live probe: ${unprobed.join(', ')} — every minted credential must name an endpoint that proves it (\`probes\`)`,
    };
  }
  const scriptAbs = path.resolve(input.repoRoot, targetPath);
  const scriptExisted = fs.existsSync(scriptAbs);
  if (scriptExisted && !(input.replaceExisting && input.existingScript?.scriptPath === targetPath)) {
    return {
      reason: `\`${targetPath}\` already exists and is not the seed being replaced — refusing to overwrite it`,
    };
  }
  const priorScript = scriptExisted ? fs.readFileSync(scriptAbs) : null;
  const recipeFile = recipePath(input.repoRoot);
  const priorRecipe = fs.readFileSync(recipeFile);

  const restore = (): void => {
    try {
      if (priorScript !== null) fs.writeFileSync(scriptAbs, priorScript);
      else fs.rmSync(scriptAbs, { force: true });
      fs.writeFileSync(recipeFile, priorRecipe);
    } catch {
      /* a tree we cannot restore must not eat the real reason below */
    }
  };

  const written = writeSeedArtifacts(
    input.repoRoot,
    { scriptPath: targetPath, scriptContent: output.script, seed: { command: output.command, provides: output.provides } },
    world.knownSchemes,
  );
  if (written.status !== 'drafted') {
    return { reason: written.status === 'failed' ? written.reason : written.reason };
  }

  // THE DONE-GATE: a FRESH world — down, up, the real runSeed (which validates
  // the manifest against the written `provides`). A cached or transcript-green
  // draft that cannot survive this is refused, and the tree is put back.
  try {
    input.onPhase?.('proving the seed in a fresh world', 'fresh-world proof');
    await services.down();
    await services.up();
    const proof = await runSeed({
      repoRoot: input.repoRoot,
      seed: written.seed,
      env: world.server.env,
      timeoutMs: DEFAULT_BUILD_TIMEOUT_MS,
      knownCredentials: world.secrets,
      ...(world.signal ? { signal: world.signal } : {}),
    });
    for (const [name, cred] of proof.credentials) {
      if (cred.value.length > 0) world.secrets.set(name, cred.value);
    }
    // The live half of the proof: the fresh world's own minted values, probed
    // through a real server boot — the same check the session iterated against.
    if (proof.credentials.size > 0 && output.probes) {
      input.onPhase?.('probing the minted credentials against the booted server', 'credential probes');
      const probed = await bootAndProbe(world, output.probes, proof.credentials, world.signal);
      if (!probed.ok) {
        restore();
        return { reason: `the fresh-world credential probe refused the seed: ${probed.reason}` };
      }
    }
    return {
      fixtures: [...proof.fixtures.keys()].sort(),
      credentials: [...proof.credentials.keys()].sort(),
    };
  } catch (error) {
    restore();
    if (error instanceof SeedError) return { reason: `the fresh-world proof refused the seed: ${error.message}` };
    return { reason: `the fresh-world proof failed: ${message(error)}` };
  } finally {
    await services.down();
  }
}

function clip(text: string): string {
  if (text.length <= MAX_TOOL_OUTPUT_CHARS) return text;
  return `… (${text.length - MAX_TOOL_OUTPUT_CHARS} chars clipped)\n${text.slice(-MAX_TOOL_OUTPUT_CHARS)}`;
}

function tail(output: string): string {
  return output.trimEnd().split('\n').slice(-5).join(' / ');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const SYSTEM_PROMPT = `You author the ONE PREPARATION SCRIPT a repository's specification-derived tests run against: it creates both the ROWS those tests reference and the AUTHENTICATED PRINCIPALS they act as. Unlike a one-shot draft, you PROVE your script here: the services are live, \`run_seed_draft\` really executes what you wrote, and the engine's fold will re-prove your outcome in a fresh world before anything lands in the repository.

Data and auth are ONE artifact on purpose: a login token cannot be minted without a user row, so seeding the principal IS seeding data. Never assume some other step created the accounts.

# The corpus-run doctrine (learned the hard way, on real repositories)

- DRIVE THE APP'S OWN SERVICES, NEVER HAND-ROLLED SQL for anything the app can create itself. A row the app's signup/service path writes carries every side effect the app expects (hashes, defaults, join rows, caches); a hand-inserted one is a landmine the tests step on later. Use the app's own ORM/client — import it the way the app's own files import it, read the connection from the SAME environment variable the app reads — and reach for raw SQL only for what no public path can create.
- PRISTINE-STATE STRATEGY: the seed runs once per guard run against a store that may carry the last run's rows. Be idempotent by STABLE NATURAL KEYS (look up before insert, or upsert) — never by truncating tables you do not own. State WHY the mechanism is idempotent in a comment block at the top of the script; that header is what a human reviews first.
- ENUM CASING IS LOAD-BEARING: the database's enum literals and the app's serialized casing often differ ("ADMIN" vs "admin"). Read the schema (and \`db_query\` the live database) for the REAL casing; a wrong-cased role authenticates as nobody.
- NO ANCHOR STALENESS: the ids/slugs/emails you declare in \`provides\` are what scenarios interpolate for the life of the corpus. Mint STABLE values (fixed emails, fixed slugs), never timestamps or randoms — a value that moves re-anchors every test that references it.
- FAIL LOUDLY: any error — a failed connection, a rejected insert, a missing env var — prints a diagnostic and exits non-zero. Never exit 0 on a partial seed.
- The manifest: the engine sets GUARD_SEED_OUT to a file path; write ONE JSON object there — {"credentials": {"<name>": {"value": "<minted secret>"}}, "fixtures": {"<name>": {"<field>": <any JSON value>}}} — matching \`provides\` EXACTLY. Values keep their native JSON type.
- Principals: one per role the app actually distinguishes; mint the secret the way the APP would (its own token issuance, or the same signing secret and algorithm it verifies with); the value must survive the seed process (stateless token or a session row — a secret held in memory authenticates nothing); the header value is injected VERBATIM ("Bearer <token>" ONLY if that is what the API's own verifier expects — read the verifier, do not assume the prefix).
- CREDENTIALS PROVE THEMSELVES LIVE: every \`run_seed_draft\` (and the outcome) that mints credentials must declare \`probes\` — per credential, one endpoint that REQUIRES it. The engine boots the server, sends the minted value verbatim, and refuses the draft if the request is rejected OR if the same request succeeds without the credential (an ungated endpoint proves nothing). Pick the cheapest truly-gated read endpoint the route surface offers.

# Your tools

- \`read_file\` / \`search_repo\` — the repository, read-only.
- \`db_query\` — ONE read-only SELECT/WITH against the live database. Verify what a draft wrote, read enum casing, count rows.
- \`check_provides\` — free static shape check of a \`provides\` declaration.
- \`run_seed_draft\` — the REAL thing: your script (scratch copy), your command, your provides (+ \`probes\` when credentials are minted), executed with GUARD_SEED_OUT and the server env against the live services, manifest validated, credentials probed against the booted server. Run it at least twice on the final draft — the second run proves idempotence.

# The outcome

\`{script, command, provides, probes, findings}\` — the script's full source, the one shell command (repo root) that runs it AT THE TARGET PATH the briefing names, the provides declaration, the credential probes (required for every declared credential; omit the field only when no credentials are minted), and any code-vs-docs contradictions you established (verbatim, two named sides; usually empty). The fold writes the files, then proves the outcome in a FRESH world (services down → up → run → probe) — an outcome that only worked against your session's warmed-up state will be refused, which is why pristine-state discipline matters. Never write repository files yourself; the fold owns every write.`;
