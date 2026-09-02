/**
 * THE DEPENDENCY CATALOG SESSION — `guard-setup.dependency-catalog`
 *.
 *
 * Deterministic first: the detection snapshot and the externals SKELETON are
 * already applied by the time this runs (the engine's catalog step does both).
 * The session's job is what no derivation can do: CLASSIFY each class of
 * starting state the program needs (`step-creatable` / `seedable` / `supplied`),
 * CONDITION the ones that only apply sometimes, and add the entries detection
 * missed — grounded in the rich in-memory detection its briefing states and in
 * what it reads in the repository.
 *
 * The outcome is {@link CatalogDraftSchema} — entries + findings — and the
 * FOLD (here, after the outcome, never in a tool) merges it into the committed
 * `scenarios/dependencies.json` and writes registration skeletons for new
 * supplied entries into the gitignored `scenarios/dependencies.local.json`.
 * ADD-ONLY by the externals-skeleton rule: an entry the catalog already
 * declares is left byte-identical — re-running detection or this session must
 * never destroy a curated classification.
 *
 * Cache: `guard/dependency-catalog`, keyed on the catalog step's own input
 * fingerprint (detection ∷ recipe ∷ committed catalog) plus the prompt
 * fingerprint — author-class, so completed drafts cache; the fold re-runs on
 * every hit (idempotent: add-only against a catalog that already has the
 * entries adds nothing).
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { defineSessionTool, type SessionDef, type SessionEvent, type SessionTool } from '@truecourse/agent-loop';
import type {
  GuardSetupCatalogSession,
  GuardSetupCatalogSessionInput,
} from '@truecourse/guard-generator';
import {
  createWorkingSandbox,
  loadDependenciesLocal,
  loadDependencyCatalog,
  dependenciesLocalPath,
  dependenciesPath,
  guardSetupFindingsPath,
  maskedRecipeText,
} from '@truecourse/guard-runner';
import {
  DEPENDENCY_NAME_PATTERN,
  type GuardDependenciesFile,
  GuardDependenciesFileSchema,
  type GuardDependenciesLocal,
  type GuardDependencyCondition,
  type GuardDependencyEntry,
  type GuardDependencyEnvVar,
  type GuardDependencyPredicate,
} from '@truecourse/shared';
import { atomicWriteJson } from '../../lib/atomic-write.js';
import { cachedSessionOutcome, promptFingerprint } from '../agent/session-cache.js';
import { appendFindingsLedger } from '../agent/findings-ledger.js';
import { runSessionPool } from '../agent/session-pool.js';
import { readFileTool, searchTool } from '../agent/repo-tools.js';
import { describeSessionFailure, type GuardSetupSessionContext } from './session-context.js';

export const DEPENDENCY_CATALOG_SESSION_KIND = 'guard-setup.dependency-catalog';
export const DEPENDENCY_CATALOG_CACHE_NAME = 'guard/dependency-catalog';

/** The three numbers: classifying a briefed detection is mostly reading
 *  plus a few probes; 12 turns covers it with a check-and-revise cycle. */
export const DEPENDENCY_CATALOG_BUDGET = { turns: 12, maxResumes: 1, tokenCeiling: 150_000 } as const;

/** How much of a probe's output one tool result carries. */
const MAX_TOOL_OUTPUT_CHARS = 8_000;

// ---------------------------------------------------------------------------
// The outcome
// ---------------------------------------------------------------------------

/**
 * The draft the session produces. `condition` is a
 * PREDICATE EXPRESSION in the closed grammar {@link parseCatalogCondition}
 * documents — machine-evaluable, because a predicate is what lets one flow
 * variant block alone; the human sentence is derived from it at fold.
 *
 * `findings` is REQUIRED (an empty array is fine), not `.default([])`: a
 * default gives the schema a different input than output type, which
 * `SessionDef`'s `z.ZodType<TOutcome>` deliberately refuses — the settle-areas
 * schema states the same rule.
 */
export const CatalogDraftSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            name: z.string().min(1),
            class: z.enum(['step-creatable', 'seedable', 'supplied']),
            condition: z.string().optional(),
            evidence: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
    findings: z.array(z.string()),
  })
  .strict();
export type CatalogDraft = z.infer<typeof CatalogDraftSchema>;

// ---------------------------------------------------------------------------
// The condition grammar — closed, evaluable, refused when it does not parse
// ---------------------------------------------------------------------------

/**
 * `condition` grammar (all predicates must hold; the sentence after `::` is
 * what every surface shows):
 *
 *   <predicate>[ && <predicate>]* :: <sentence>
 *   predicate := config-value:<key>=<value>
 *              | language-present:<language>
 *              | command-path:<interfaceId>
 *
 * e.g. `config-value:llm.transport=api :: only when the LLM transport is the direct API`
 */
export function parseCatalogCondition(
  raw: string,
): { ok: true; condition: GuardDependencyCondition } | { ok: false; error: string } {
  const split = raw.split('::');
  if (split.length !== 2) {
    return {
      ok: false,
      error: `a condition is \`<predicate>[ && <predicate>] :: <sentence>\` — got ${JSON.stringify(raw)}`,
    };
  }
  const sentence = split[1].trim();
  if (sentence.length === 0) return { ok: false, error: 'the condition sentence (after `::`) is empty' };
  const predicates: GuardDependencyPredicate[] = [];
  for (const part of split[0].split('&&').map((p) => p.trim())) {
    const colon = part.indexOf(':');
    if (colon === -1) return { ok: false, error: `predicate ${JSON.stringify(part)} has no kind prefix` };
    const kind = part.slice(0, colon);
    const rest = part.slice(colon + 1);
    if (kind === 'config-value') {
      const eq = rest.indexOf('=');
      if (eq <= 0 || eq === rest.length - 1) {
        return { ok: false, error: `config-value predicate needs \`<key>=<value>\` — got ${JSON.stringify(rest)}` };
      }
      predicates.push({ kind: 'config-value', key: rest.slice(0, eq), value: rest.slice(eq + 1) });
    } else if (kind === 'language-present') {
      if (rest.length === 0) return { ok: false, error: 'language-present predicate names no language' };
      predicates.push({ kind: 'language-present', language: rest });
    } else if (kind === 'command-path') {
      if (rest.length === 0) return { ok: false, error: 'command-path predicate names no interface id' };
      predicates.push({ kind: 'command-path', interfaceId: rest });
    } else {
      return {
        ok: false,
        error: `unknown predicate kind ${JSON.stringify(kind)} — the closed set is config-value, language-present, command-path`,
      };
    }
  }
  if (predicates.length === 0) return { ok: false, error: 'a condition needs at least one predicate' };
  return { ok: true, condition: { predicates, sentence } };
}

// ---------------------------------------------------------------------------
// The validation the fold enforces — and `check_catalog` runs verbatim
// ---------------------------------------------------------------------------

/**
 * Every rule the fold will hold the draft to, as complaints. The
 * validator-as-tool pattern: `check_catalog` runs exactly this, so a draft
 * that checks clean cannot be refused afterwards.
 */
export function validateCatalogDraft(
  draft: CatalogDraft,
  input: GuardSetupCatalogSessionInput,
  existing: GuardDependenciesFile,
): string[] {
  const complaints: string[] = [];
  const seen = new Set<string>();
  for (const entry of draft.entries) {
    if (!DEPENDENCY_NAME_PATTERN.test(entry.name)) {
      complaints.push(`entry name "${entry.name}" is not lower-kebab-case`);
    }
    if (seen.has(entry.name)) complaints.push(`entry "${entry.name}" appears twice in the draft`);
    seen.add(entry.name);
    if (entry.condition !== undefined) {
      const parsed = parseCatalogCondition(entry.condition);
      if (!parsed.ok) complaints.push(`entry "${entry.name}": ${parsed.error}`);
    }
  }
  // Every SUBSTANTIATED detected service accounted for: by a draft entry (its
  // name, since an external-service entry is named for its service), by an
  // existing catalog entry that names it, or by the recipe's own
  // `api.externals` declaration (the skeleton just wrote those). Substantiated
  // = an SDK-registry match (`category`) or a base-URL env var — the skeleton's
  // own declarability bar. URL-mined services with neither are dumb evidence (a
  // hardcoded literal somewhere), and forcing an entry per hostname is how
  // cal.diy's 81-service detection drowned the 2026-08-20 catalog in 65 junk
  // rows: noise amplified into curation.
  const declaredByRecipe = new Set([...input.skeleton.declared, ...input.skeleton.alreadyDeclared]);
  const namedByCatalog = new Set(existing.dependencies.flatMap((d) => d.services ?? []));
  for (const service of input.detected) {
    if (!substantiatedService(service)) continue;
    const name = service.service;
    if (seen.has(name) || declaredByRecipe.has(name) || namedByCatalog.has(name)) continue;
    complaints.push(
      `detected service "${name}" is not accounted for — add an entry for it (a supplied external account is the usual class), or it will stay invisible to flow gating`,
    );
  }
  return complaints;
}

/** A detected service worth FORCING into the catalog: an SDK-registry match or
 *  a base-URL env var. The rest stays visible in the briefing as information. */
function substantiatedService(service: GuardSetupCatalogSessionInput['detected'][number]): boolean {
  return service.category !== undefined || service.baseUrlEnv !== undefined || (service.baseUrlEnvs?.length ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// The fold — the ONLY writes of this step's session half
// ---------------------------------------------------------------------------

export interface CatalogFoldResult {
  /** Names newly added to the committed catalog (existing names are never edited). */
  added: string[];
  /** Names skipped because the catalog already declares them. */
  alreadyDeclared: string[];
}

/**
 * Merge a VALIDATED draft into the two catalog files. ADD-ONLY: the committed
 * file only ever grows, and an entry a human (or an earlier fold) already
 * declared is left byte-identical. Supplied entries get their machine-side
 * skeleton: an env-shaped registration derived from detection when the entry
 * IS a detected service (its base-URL variables), a path registration
 * otherwise (a real-world input the engine must never fabricate is usually a
 * project/corpus on disk); and an empty instance row in the gitignored overlay
 * so the user sees exactly which fields to fill in.
 */
export function foldCatalogDraft(
  input: GuardSetupCatalogSessionInput,
  draft: CatalogDraft,
): CatalogFoldResult {
  const catalog: GuardDependenciesFile = {
    dependencies: [...loadDependencyCatalog(input.repoRoot).dependencies],
  };
  const local: GuardDependenciesLocal = { ...loadDependenciesLocal(input.repoRoot) };
  const existingNames = new Set(catalog.dependencies.map((d) => d.name));
  const detectedByName = new Map(input.detected.map((d) => [d.service, d]));

  const added: string[] = [];
  const alreadyDeclared: string[] = [];
  let localTouched = false;

  for (const draftEntry of draft.entries) {
    if (existingNames.has(draftEntry.name)) {
      alreadyDeclared.push(draftEntry.name);
      continue;
    }
    const condition = draftEntry.condition ? parseCatalogCondition(draftEntry.condition) : null;
    if (condition && !condition.ok) {
      // The draft was validated before the fold; a parse failure here is a
      // caller defect and must be loud, never a silently unconditional entry.
      throw new Error(`entry "${draftEntry.name}": ${condition.error}`);
    }
    const detected = detectedByName.get(draftEntry.name);
    const entry: GuardDependencyEntry = {
      name: draftEntry.name,
      class: draftEntry.class,
      summary: draftEntry.evidence,
      needs: [],
      ...(condition ? { condition: condition.condition } : {}),
      ...(detected ? { services: [draftEntry.name] } : {}),
      ...(draftEntry.class === 'supplied'
        ? { registration: suppliedRegistration(draftEntry, detected) }
        : {}),
    };
    catalog.dependencies.push(entry);
    existingNames.add(entry.name);
    added.push(entry.name);

    // The instance SKELETON: only for a new env-shaped supplied entry with no
    // row yet — the overlay is the user's file, and a row that exists is theirs.
    if (entry.class === 'supplied' && entry.registration?.kind === 'env' && local[entry.name] === undefined) {
      local[entry.name] = {
        env: Object.fromEntries(entry.registration.vars.map((v) => [v.name, ''])),
      };
      localTouched = true;
    }
  }

  if (added.length > 0) {
    catalog.dependencies.sort((a, b) => a.name.localeCompare(b.name));
    const validated = GuardDependenciesFileSchema.safeParse(catalog);
    if (!validated.success) {
      throw new Error(
        `the merged dependencies.json would be invalid: ${validated.error.issues
          .map((i) => `${i.path.join('.')} ${i.message}`)
          .join('; ')}`,
      );
    }
    atomicWriteJson(dependenciesPath(input.repoRoot), catalog);
    if (localTouched) atomicWriteJson(dependenciesLocalPath(input.repoRoot), local);
  }
  return { added, alreadyDeclared };
}

/** The registration a new supplied entry starts with. See {@link foldCatalogDraft}. */
function suppliedRegistration(
  draftEntry: CatalogDraft['entries'][number],
  detected: GuardSetupCatalogSessionInput['detected'][number] | undefined,
): NonNullable<GuardDependencyEntry['registration']> {
  const vars: GuardDependencyEnvVar[] = [];
  const seen = new Set<string>();
  for (const ref of detected?.baseUrlEnvs ?? []) {
    if (seen.has(ref.envVar)) continue;
    seen.add(ref.envVar);
    vars.push({
      name: ref.envVar,
      description: `the base URL the program reads ${draftEntry.name} from`,
      secret: false,
    });
  }
  if (detected?.baseUrlEnv && !seen.has(detected.baseUrlEnv)) {
    vars.push({
      name: detected.baseUrlEnv,
      description: `the base URL the program reads ${draftEntry.name} from`,
      secret: false,
    });
  }
  if (vars.length > 0) return { kind: 'env', vars };
  // No detected variables to register through: the honest default for a
  // real-world input is a path on this machine (a project, a corpus, a config
  // tree). A user can re-shape the registration by hand — the overlay row keys
  // on the entry name either way.
  return { kind: 'path', description: draftEntry.evidence };
}

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

export function dependencyCatalogSessionDef(
  input: GuardSetupCatalogSessionInput,
  existing: GuardDependenciesFile,
): SessionDef<CatalogDraft> {
  return {
    kind: DEPENDENCY_CATALOG_SESSION_KIND,
    display: {
      intro: 'I\'m classifying the starting state this program needs — what a test can create, what must be seeded, and what only a user can supply.',
    },
    systemPrompt: SYSTEM_PROMPT,
    tools: [
      readFileTool(input.repoRoot),
      searchTool(input.repoRoot),
      runProgramTool(),
      checkCatalogTool(input, existing),
    ],
    outcomeSchema: CatalogDraftSchema,
    budget: DEPENDENCY_CATALOG_BUDGET,
    outcomePrecondition: {
      tool: 'check_catalog',
      message:
        'Outcome refused: you never ran `check_catalog` in this session. Call it on your complete draft now — it runs the exact validation the fold will run (names, conditions, every detected service accounted for), so a problem it finds costs one turn here instead of the whole draft at the outcome. Fix anything it reports, then call `outcome` again.',
    },
    // The in-flight sibling (2026-08-21 bench: two of three documenso catalog
    // runs spent all 24 turns on read_file/search_repo, drafted at most once,
    // and died at the ceiling — briefing prose alone does not make a session
    // draft in time).
    draftCheckpoint: {
      tool: 'check_catalog',
      afterTurn: 6,
      message:
        '[checkpoint] You have spent more than half your first turn grant without drafting. Call `check_catalog` on your best current draft NOW — the briefing already carries the detection, the corpus areas and the grain guidance, and the checker\'s complaints steer better than more reading. Iterate from the draft; do not return to open-ended exploration.',
    },
  };
}

/** The opening message: the rich detection, the recipe, the existing catalog,
 *  and the skeleton's account — everything already established, stated so the
 *  session classifies instead of rediscovering. */
export function dependencyCatalogBriefing(
  input: GuardSetupCatalogSessionInput,
  existing: GuardDependenciesFile,
): string {
  const lines: string[] = [
    'Classify the DEPENDENCY CATALOG of this repository: the classes of starting state the program under test needs, each obtained one of exactly three ways (step-creatable / seedable / supplied).',
    '',
    'A catalog is a HANDFUL of entries — the DOMAIN OBJECTS the documented flows stand on (an account, the central resource, the thing scenarios create and mutate) plus the real-world inputs nothing may fabricate. It is NOT one row per hostname: only the substantiated services listed below need accounting for.',
  ];
  const areas = corpusAreaSummary(input.repoRoot);
  if (areas.length > 0) {
    lines.push('', '## The documented areas (the spec corpus — what scenarios will exercise)');
    lines.push(...areas.map((a) => `- ${a.area} (${a.docs} doc${a.docs === 1 ? '' : 's'})`));
    lines.push('The starting state those flows need is the catalog. The database tables below name the same domain.');
  }
  const substantiated = input.detected.filter((s) => substantiatedService(s));
  const informational = input.detected.filter((s) => !substantiatedService(s));
  lines.push('', '## Detected external services that MUST be accounted for (SDK match or base-URL var)');
  if (substantiated.length === 0) lines.push('(none)');
  for (const service of substantiated) {
    const vars = (service.baseUrlEnvs ?? []).map((v) => v.envVar).join(', ') || service.baseUrlEnv || '(no base-URL var)';
    const evidence = service.evidence
      .slice(0, 3)
      .map((e) => e.filePath)
      .join(', ');
    lines.push(
      `- ${service.service}${service.category ? ` (${service.category})` : ''} · via ${service.source ?? 'sdk'} · base-URL vars: ${vars} · seen in: ${evidence}`,
    );
  }
  if (informational.length > 0) {
    lines.push(
      '',
      '## Hostnames also seen in the source (INFORMATION ONLY — do NOT write entries for these)',
      informational.map((s) => s.service).join(', '),
    );
  }
  lines.push('', '## Database');
  if (input.database) {
    lines.push(
      `${input.database.driver}/${input.database.type}, ${input.database.tables.length} parsed tables: ${input.database.tables
        .slice(0, 40)
        .map((t) => t.name)
        .join(', ')}`,
    );
    if (input.database.relations.length > 0) {
      lines.push(`${input.database.relations.length} relations parsed.`);
    }
  } else {
    lines.push('(no database detected)');
  }
  if (input.datastoreUrls.length > 0) {
    lines.push('', '## Datastore URLs the source declares');
    lines.push(...input.datastoreUrls.slice(0, 6).map((ref) => `- ${JSON.stringify(ref)}`));
  }
  lines.push(
    '',
    '## The verified recipe',
    // Masked: a recipe may carry an inline credential value, and a briefing
    // enters a persisted transcript.
    maskedRecipeText(JSON.stringify(input.recipe)) ?? '(unreadable)',
    '',
    '## The externals skeleton this run already applied to recipe.json',
    `declared now: ${input.skeleton.declared.join(', ') || '(none)'}`,
    `already declared: ${input.skeleton.alreadyDeclared.join(', ') || '(none)'}`,
    `undeclarable (no base-URL var detected): ${input.skeleton.undeclarable.join(', ') || '(none)'}`,
    '',
    '## The committed catalog as it stands (scenarios/dependencies.json)',
    existing.dependencies.length === 0
      ? '(empty — no entries yet)'
      : existing.dependencies
          .map((d) => `- ${d.name} · ${d.class}${d.services?.length ? ` · services: ${d.services.join(', ')}` : ''} · ${d.summary}`)
          .join('\n'),
    '',
    'Entries already in the catalog are settled — the fold never edits them. Your entries ADD: the domain classes of starting state the documented flows need (think: the account that acts, the central resource, what a flow books/signs/publishes), every unaccounted MUST-account service above, conditions for what only applies sometimes, and the real-world inputs the engine must never fabricate. The briefing already carries the established facts — read a handful of files at most, and use `run_program` only where observation settles what reading cannot. Call `check_catalog` on a draft NO LATER than the midpoint of your turn budget; an early imperfect draft it can correct beats a perfect draft you never produce.',
  );
  return lines.join('\n');
}

/** The corpus's area tags with their doc counts — the domain map the catalog
 *  grounds on. A missing/unreadable corpus yields nothing, never a failure. */
function corpusAreaSummary(repoRoot: string): { area: string; docs: number }[] {
  const file = path.join(repoRoot, '.truecourse', 'specs', 'corpus.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      docs?: { areaTags?: string[] }[];
    };
    const counts = new Map<string, number>();
    for (const doc of parsed.docs ?? []) {
      for (const tag of doc.areaTags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([area, docs]) => ({ area, docs }));
  } catch {
    return [];
  }
}

function runProgramTool(): SessionTool {
  return defineSessionTool({
    name: 'run_program',
    description:
      'Run one argv in a FRESH throwaway sandbox (isolated HOME, allowlist env, nothing persists between calls). Observing how a program fails without its dependencies is how you name them — a missing-key error names the key.',
    kind: 'run-program',
    readOnly: false,
    destructive: false,
    inputSchema: z
      .object({
        argv: z.array(z.string()).min(1),
        env: z.record(z.string(), z.string()).optional(),
      })
      .strict(),
    async execute(args, toolCtx) {
      const sandbox = createWorkingSandbox();
      try {
        const capture = await sandbox.exec(args.argv, {
          ...(args.env ? { env: args.env } : {}),
          timeoutMs: 60_000,
          ...(toolCtx.signal ? { signal: toolCtx.signal } : {}),
        });
        if (capture.spawnError) return { content: `spawn failed: ${capture.spawnError}`, isError: true };
        const head = `exit ${capture.exitCode ?? `signal ${capture.signal ?? 'none'}`}${capture.timedOut ? ' (timed out)' : ''}`;
        const body = [
          capture.stdout.trim() ? `stdout:\n${clip(capture.stdout)}` : '',
          capture.stderr.trim() ? `stderr:\n${clip(capture.stderr)}` : '',
        ]
          .filter(Boolean)
          .join('\n');
        return { content: body ? `${head}\n${body}` : `${head}\n(no output)` };
      } catch (error) {
        return { content: error instanceof Error ? error.message : String(error), isError: true };
      } finally {
        sandbox.cleanup();
      }
    },
  });
}

function checkCatalogTool(
  input: GuardSetupCatalogSessionInput,
  existing: GuardDependenciesFile,
): SessionTool {
  return defineSessionTool({
    name: 'check_catalog',
    description:
      'Check a catalog draft against every rule the fold enforces — kebab-case names, the condition grammar, and every detected service accounted for. Call it on your complete draft before you produce the outcome; a draft that checks clean is a draft that lands.',
    kind: 'check-catalog',
    readOnly: true,
    destructive: false,
    inputSchema: CatalogDraftSchema,
    async execute(args) {
      const complaints = validateCatalogDraft(args, input, existing);
      if (complaints.length === 0) {
        return {
          content: `The draft is valid: ${args.entries.length} entr${args.entries.length === 1 ? 'y' : 'ies'}, every detected service accounted for. Produce it as the outcome.`,
        };
      }
      return { content: `${complaints.length} problem(s):\n- ${complaints.join('\n- ')}`, isError: true };
    },
  });
}

// ---------------------------------------------------------------------------
// The seam implementation the engine's catalog step calls
// ---------------------------------------------------------------------------

export interface BuildCatalogSessionOptions {
  signal?: AbortSignal;
  onSessionEvent?: (workItem: string, event: SessionEvent) => void;
}

function catalogCacheKey(stepFingerprint: string): string {
  return createHash('sha256')
    .update(`${promptFingerprint(SYSTEM_PROMPT)}::${stepFingerprint}`)
    .digest('hex');
}

/**
 * The `GuardSetupCatalogSession` the command adapter injects. One session,
 * concurrency 1; the fold runs here after the outcome — on cache hits too,
 * where its add-only merge makes the write idempotent. Findings are appended
 * to the committed `guard/setup.findings.md` ledger only when the session
 * actually RAN (a cache hit re-appending them every run would drown the feed).
 */
export function buildCatalogSession(
  context: GuardSetupSessionContext,
  opts: BuildCatalogSessionOptions = {},
): GuardSetupCatalogSession {
  return async (input) => {
    try {
      const existing = loadDependencyCatalog(input.repoRoot);
      const outcome = await cachedSessionOutcome<CatalogDraft>({
        repoRoot: input.repoRoot,
        cacheName: DEPENDENCY_CATALOG_CACHE_NAME,
        key: catalogCacheKey(input.fingerprint),
        schema: CatalogDraftSchema,
        run: async () => {
          const { driver, persistence } = await context.acquire();
          const results = await runSessionPool<GuardSetupCatalogSessionInput, CatalogDraft>({
            items: [input],
            workItem: () => 'dependency-catalog',
            session: () => dependencyCatalogSessionDef(input, existing),
            briefing: () => [dependencyCatalogBriefing(input, existing)],
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
          return result;
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

      // The fold's own validation — never trust an outcome the tool did not
      // check (the precondition makes that rare, not impossible) or a cached
      // draft the world has moved under.
      const complaints = validateCatalogDraft(outcome.output, input, existing);
      if (complaints.length > 0) {
        return {
          status: 'failed',
          reason: `the catalog draft was refused: ${complaints.join('; ')}`,
          ...(sessionRunId ? { sessionRunId } : {}),
        };
      }
      const folded = foldCatalogDraft(input, outcome.output);
      if (!outcome.fromCache && outcome.output.findings.length > 0) {
        appendFindingsLedger({
          repoRoot: input.repoRoot,
          ledgerPath: guardSetupFindingsPath(input.repoRoot),
          runId: sessionRunId ?? 'guard-setup',
          findings: [{ workItem: 'dependency-catalog', lines: outcome.output.findings }],
          preamble:
            '# Guard setup findings\n\nCode-vs-docs discrepancies the setup sessions read. Append-only; one section per run.\n\n',
        });
      }
      return {
        status: 'ok',
        added: folded.added,
        findings: outcome.output.findings,
        ...(sessionRunId ? { sessionRunId } : {}),
        ...(outcome.fromCache ? { fromCache: true } : {}),
      };
    } catch (error) {
      return {
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
        ...(context.runId() ? { sessionRunId: context.runId() } : {}),
      };
    }
  };
}

function clip(text: string): string {
  if (text.length <= MAX_TOOL_OUTPUT_CHARS) return text;
  return `… (${text.length - MAX_TOOL_OUTPUT_CHARS} chars clipped)\n${text.slice(-MAX_TOOL_OUTPUT_CHARS)}`;
}

const SYSTEM_PROMPT = `You classify the DEPENDENCY CATALOG for TrueCourse guard: the classes of starting state the program under test needs, and how a test scenario may obtain each one.

# The three classes — the whole vocabulary

- \`step-creatable\` — the public surface itself can create it (an init command, a signup endpoint). The preferred class; no seeding needed.
- \`seedable\` — cannot be created through public steps but CAN be materialized deterministically before they run: files, configuration, database rows.
- \`supplied\` — a real-world input the engine must never fabricate: a real project or corpus the program operates ON, credentials to a third-party system, an authenticated state. The catalog declares it EXISTS; the user registers instances.

The boundary between the first two and the third is TRANSACTIONAL vs DURABLE: what a test may create and mutate within its own run is creatable/seedable; anything durable that must pre-exist is supplied.

# What you produce

\`entries\`: one per class of starting state — \`name\` (lower-kebab-case; an external service's entry is named FOR the service, e.g. \`stripe\`), \`class\`, \`evidence\` (one line: what you read that establishes this need — a file, an import, an error), and optionally \`condition\` when the dependency only applies sometimes.

The catalog's grain is the DOMAIN, not the network graph: the account that acts, the central resource the flows create and mutate (a booking, a document, a content entry), the workspace/team it lives in, the credential that authenticates — a HANDFUL of entries. The briefed database tables and documented areas name these objects. An external service earns an entry only when it appears in the must-account list of your briefing; hostnames outside that list get NO entry.

A \`condition\` is a machine-evaluable predicate expression, closed grammar:
  \`<predicate>[ && <predicate>] :: <sentence>\`
  predicates: \`config-value:<key>=<value>\` · \`language-present:<language>\` · \`command-path:<interfaceId>\`
The sentence after \`::\` is what humans read. A dependency that always applies carries NO condition — absent is the honest default, never a stand-in for "did not look".

\`findings\`: contradictions you established between what the repository SAYS (docs, comments, the briefed detection) and what the source SHOWS — two named sides per line, verbatim. Not your uncertainty, not style notes. Usually empty.

# The rules that are checked

1. Every service in the briefing's MUST-account list (SDK match or base-URL var) must be accounted for — by one of your entries, an existing catalog entry, or the recipe's own externals declaration. \`check_catalog\` refuses a draft that leaves one invisible. The information-only hostnames are exempt — and adding entries for them is wrong, not thorough.
2. Existing catalog entries are settled: never restate one — the fold ignores duplicates rather than editing curated work.
3. Nothing is guessed. Evidence names what you read. Use \`run_program\` to observe how the program actually fails without a dependency — the error message is the honest evidence.

# How to work

Read the briefing first — the detection, the schema, the documented areas, the recipe are already established facts; most of the catalog is derivable from them alone. Read the repository ONLY where classification needs the source (does the CLI have an init command, or must the project pre-exist?) — a handful of files, not a survey. Draft EARLY: call \`check_catalog\` on a draft no later than the midpoint of your turn budget, fix what it reports, then produce the outcome. A session that spends every turn reading and never drafts settles nothing.`;
