/** Targeted private-data authoring. Existing recipe/seed/interfaces are preserved. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { defineSessionTool, type SessionDef } from '@truecourse/agent-loop';
import type {
  GuardSetupPreparationSession,
  GuardSetupPreparationSessionInput,
} from '@truecourse/guard-generator';
import {
  RecipePreparationSchema,
  preparationDependencyBriefing,
  resolvePreparationDependencies,
  PREPARATION_VERIFY_INPUTS_SOURCE,
  RecipeSchema,
  prepareScenario,
  recipePath,
  runBuild,
  runInstall,
  buildCredentialRedactor,
  type BuildResult,
  hashableRecipeText,
  type Recipe,
} from '@truecourse/guard-runner';
import { runSessionPool } from '../agent/session-pool.js';
import { readFileTool, searchTool } from '../agent/repo-tools.js';
import {
  describeSessionFailure,
  type GuardSetupSessionContext,
} from './session-context.js';

export const PREPARATION_SESSION_KIND = 'guard-setup.preparations';
export const PREPARATION_SESSION_BUDGET = { turns: 20, maxResumes: 1, tokenCeiling: 200_000 };
export const PreparationDraftSchema = z
  .object({
    profiles: z.array(
      z
        .object({
          name: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
          baseline: z.enum(['empty', 'seeded']),
          needs: RecipePreparationSchema.innerType().shape.needs.unwrap(),
          baselineChecks: RecipePreparationSchema.innerType().shape.baselineChecks.unwrap(),
          env: RecipePreparationSchema.innerType().shape.env,
          postgres: RecipePreparationSchema.innerType().shape.postgres,
          seed: z.string().min(1),
          provides: RecipePreparationSchema.innerType().shape.seed.shape.provides,
          verify: z.string().min(1),
          cleanup: z.string().min(1).optional(),
        })
        .strict().superRefine((profile, ctx) => {
          const result = RecipePreparationSchema.safeParse({
            baseline: profile.baseline, needs: profile.needs, scope: 'instance', env: profile.env, postgres: profile.postgres,
            baselineChecks: profile.baselineChecks,
            seed: { script: 'seed.mjs', provides: profile.provides },
            verify: { script: 'verify.mjs' }, ...(profile.cleanup ? { cleanup: { script: 'cleanup.mjs' } } : {}),
          });
          if (!result.success) for (const issue of result.error.issues) ctx.addIssue(issue);
        }),
    ),
    findings: z.array(z.string().min(1)),
  })
  .strict()
  .refine(
    (draft) => draft.profiles.length > 0 || draft.findings.length > 0,
    'Unavailable private preparation requires a precise finding',
  );
export type PreparationDraft = z.infer<typeof PreparationDraftSchema>;
const identity = (draft: PreparationDraft) =>
  createHash('sha256').update(JSON.stringify(draft.profiles)).digest('hex');

/** The same fold serves tool checks and final persistence. All writes are rolled back on refusal. */
export async function verifyPreparationDraft(
  input: GuardSetupPreparationSessionInput,
  draft: PreparationDraft,
  options: { persist?: boolean; signal?: AbortSignal } = {},
): Promise<void> {
  draft = PreparationDraftSchema.parse(draft);
  if (new Set(draft.profiles.map((p) => p.name)).size !== draft.profiles.length)
    throw new Error('Preparation names must be unique');
  // Check every profile before staging scripts or executing any earlier profile.
  for (const profile of draft.profiles)
    resolvePreparationDependencies(input.repoRoot, input.recipe, profile.needs);
  const snapshots = new Map<string, Buffer | null>();
  const record = (file: string, body: string) => {
    if (!snapshots.has(file))
      snapshots.set(file, fs.existsSync(file) ? fs.readFileSync(file) : null);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  };
  // Staging remains repository-owned so Node can import the application's dependencies.
  const prefix = options.persist
    ? '.truecourse/scenarios/preparations'
    : `.truecourse/.cache/guard/preparations/${randomUUID()}`;
  let succeeded = false;
  try {
    const profiles: NonNullable<Recipe['preparations']> = {
      ...input.recipe.preparations,
    };
    for (const draftProfile of draft.profiles) {
      const base = `${prefix}/${draftProfile.name}`;
      const script = (kind: 'seed' | 'verify' | 'cleanup', body: string) => {
        const rel = `${base}/${kind}.mjs`;
        record(path.join(input.repoRoot, rel), body);
        return rel;
      };
      profiles[draftProfile.name] = {
        scope: 'instance',
        baseline: draftProfile.baseline,
        needs: draftProfile.needs,
        baselineChecks: draftProfile.baselineChecks,
        env: draftProfile.env,
        ...(draftProfile.postgres ? { postgres: draftProfile.postgres } : {}),
        seed: {
          script: script('seed', draftProfile.seed),
          provides: draftProfile.provides,
        },
        verify: { script: script('verify', draftProfile.verify) },
        ...(draftProfile.cleanup
          ? { cleanup: { script: script('cleanup', draftProfile.cleanup) } }
          : {}),
      };
    }
    const recipe = RecipeSchema.parse({
      ...input.recipe,
      preparations: profiles,
    });
    for (const profile of draft.profiles) {
      const world = await prepareScenario({
        repoRoot: input.repoRoot,
        recipe,
        profile: profile.name,
        signal: options.signal,
      });
      await world.close();
    }
    if (options.persist)
      record(
        recipePath(input.repoRoot),
        JSON.stringify(recipe, null, 2) + '\n',
      );
    succeeded = true;
  } finally {
    if (!options.persist || !succeeded)
      for (const [file, body] of [...snapshots].reverse()) {
        if (body === null) fs.rmSync(file, { force: true });
        else fs.writeFileSync(file, body);
      }
    if (!options.persist)
      fs.rmSync(path.join(input.repoRoot, prefix), {
        recursive: true,
        force: true,
      });
  }
}

export function buildPreparationSession(
  context: GuardSetupSessionContext,
  opts: { signal?: AbortSignal } = {},
): GuardSetupPreparationSession {
  return async (input) => {
    let servicesStarted = false;
    let verified: string | undefined;
    let verificationFailure: string | undefined;
    const secrets = new Map(Object.entries({ ...input.recipe.env, ...input.recipe.api?.env }));
    for (const [key, value] of [...secrets]) {
      try {
        const password = new URL(value).password;
        if (password) {
          secrets.set(`${key}.password`, password);
          secrets.set(`${key}.decoded-password`, decodeURIComponent(password));
        }
      } catch { /* Non-URL environment values are already covered. */ }
    }
    const redact = buildCredentialRedactor(secrets);
    const failure = (stage: string, result: BuildResult) => ({
      status: 'failed' as const,
      reason: `${stage} failed before private preparation verification (${opts.signal?.aborted ? 'cancelled' : result.timedOut ? 'timed out' : `exit ${result.exitCode ?? 'unknown'}`}):\n${redact(result.output).trim().slice(-4000) || 'No command output was captured.'}`,
    });
    try {
      // A targeted hosted run starts in a fresh clone; replaying recipe/seed
      // artifacts does not install the application's dependencies there.
      if (input.recipe.install) {
        input.onPhase?.('installing application dependencies', 'install');
        const install = await runInstall(input.repoRoot, input.recipe.install, input.recipe.env, 600_000, opts.signal);
        if (!install.ok) return failure('Application install', install);
      }
      input.onPhase?.('building the application', 'build');
      const build = await runBuild(
        input.repoRoot,
        input.recipe.build,
        input.recipe.env,
        600_000,
        opts.signal,
      );
      if (!build.ok) return failure('Application build', build);
      if (input.recipe.api?.services) {
        input.onPhase?.('starting shared services', 'services');
        const up = await runBuild(
          input.repoRoot,
          input.recipe.api.services.up,
          input.recipe.env,
          600_000,
          opts.signal,
        );
        if (!up.ok) return failure('Shared services', up);
        servicesStarted = true;
      }
      input.onPhase?.('authoring and verifying private starting states', 'preparations');
      const { driver, persistence } = await context.acquire();
      const def: SessionDef<PreparationDraft> = {
        kind: PREPARATION_SESSION_KIND,
        display: { title: 'Preparations' },
        systemPrompt: PREPARATION_PROMPT,
        budget: PREPARATION_SESSION_BUDGET,
        tools: [
          readFileTool(input.repoRoot),
          searchTool(input.repoRoot),
          defineSessionTool({
            name: 'verify_preparations',
            description:
              'Run proposed private preparation scripts against two app worlds, without changing saved setup.',
            kind: 'verify-preparations',
            inputSchema: PreparationDraftSchema,
            readOnly: false,
            destructive: false,
            async execute(draft) {
              if (!draft.profiles.length)
                return { isError: true, content: 'verify_preparations requires at least one profile; an empty draft cannot resolve a verification failure.' };
              try {
                await verifyPreparationDraft(input, draft, {
                  signal: opts.signal,
                });
                verified = identity(draft);
                verificationFailure = undefined;
                return {
                  content:
                    'Private baseline and cross-world independence verified through the application.',
                };
              } catch (error) {
                verified = undefined;
                verificationFailure = redact(error instanceof Error ? error.message : String(error));
                return {
                  content: `Preparation verification refused: ${verificationFailure}`,
                  isError: true,
                };
              }
            },
          }),
        ],
        outcomeSchema: PreparationDraftSchema,
        validateOutcome(outcome) {
          if (verificationFailure)
            return `Repair the failed preparation and pass verify_preparations before ending. Returning no profiles cannot turn a verification failure into unsupported isolation. Last failure: ${verificationFailure}`;
          return (outcome.profiles.length > 0 || verified !== undefined) && identity(outcome) !== verified
            ? 'Run verify_preparations on this exact draft and repair every refusal before ending.'
            : undefined;
        },
      };
      const results = await runSessionPool<
        GuardSetupPreparationSessionInput,
        PreparationDraft
      >({
        items: [input],
        workItem: () => 'preparations',
        session: () => def,
        briefing: () => [
          JSON.stringify({
            recipe: JSON.parse(
              hashableRecipeText(JSON.stringify(input.recipe)),
            ),
            dependencyAvailability: preparationDependencyBriefing(input.repoRoot, input.recipe),
            specExcerpts: input.specExcerpts,
            repoRoot: input.repoRoot,
          }),
        ],
        driver,
        persistence,
        concurrency: 1,
        ...(opts.signal ? { signal: opts.signal } : {}),
        fold: () => {},
      });
      const result = results[0]?.outcome;
      if (!result)
        return {
          status: 'failed',
          reason: 'Preparation session did not start',
        };
      context.note(result.status);
      context.addSpend(1, result.spent);
      if (result.status !== 'completed')
        return {
          status: 'failed',
          reason: verificationFailure
            ? `Preparation verification failed: ${verificationFailure}`
            : describeSessionFailure(result.failure),
        };
      if (opts.signal?.aborted)
        return { status: 'failed', reason: 'Preparation authoring aborted' };
      await verifyPreparationDraft(input, result.output, {
        persist: true,
        signal: opts.signal,
      });
      return {
        status: result.output.profiles.length ? 'ok' : 'skipped',
        reason: result.output.findings.join('; ') || undefined,
        findings: result.output.findings,
        ...(context.runId() ? { sessionRunId: context.runId() } : {}),
      };
    } catch (error) {
      return {
        status: 'failed',
        reason: redact(error instanceof Error ? error.message : String(error)),
      };
    } finally {
      if (servicesStarted && input.recipe.api?.services?.down)
        await runBuild(
          input.repoRoot,
          input.recipe.api.services.down,
          input.recipe.env,
          600_000,
        );
    }
  };
}

export const PREPARATION_PROMPT = `Author private starting states supported by THIS application's actual configuration. Read the datastore path/URL/schema handling and business specs. Preserve existing main seed, interfaces, dependencies, credentials and profiles. Return no profiles with precise findings when the application cannot isolate the actual query scope. A tenant cannot establish instance-wide totals.
Use named profiles with baseline empty or seeded, instance scope, and environment bindings using \${directory} or \${namespace}. For SQLite use the app's supported path variable pointing inside \${directory}. For PostgreSQL use postgres:{isolation:'database',urlEnvs:['APP_DATABASE_URL','APP_DIRECT_URL']} with the ACTUAL app env names; env may be empty in this case. The runner derives private URLs from the resolved recipe/account bindings, preserving connection options and selecting the allocated database name. Read datasource configuration, all runtime/direct clients, migration commands and SQL before authoring. Prisma schema parameters alone do NOT isolate migrations or raw SQL that names public explicitly. No global resets or unsupported MySQL isolation.
The briefing includes dependencyAvailability resolved from the dependency catalog and the local registrations, including catalog-only services. Treat provided, incomplete and unprovided states as constraints. Each profile MUST declare needs: ['canonical-catalog-name'] for every supplied dependency used by its seed, baseline reads, verifier mutations or cleanup; use needs: [] only when none are used. Do not assume an SDK import, API schema or recipe declaration means an account is provided. An unrelated unavailable service must not block local preparation. Select operations supported by the recipe's actual configuration without that service. Before selecting an observation or mutation, read its IMPLEMENTATION and follow its dependency and configuration guards; an API contract alone is insufficient. For example, database-backed upload storage cannot use an S3-only document endpoint when S3 is unprovided. Do not switch transports, fabricate accounts or omit a dependency to make the gate pass. Supplied path/config-directory instances cannot currently be materialized by preparation scripts; use a supported alternative or report the limitation. Choose mutations affecting the business records whose isolation you are proving, not an unrelated entity merely because it is easy to mutate.
An empty profile contains ZERO business records. Provision schema and required credentials only; never copy the main seed's business fixtures into it. Keep example expenses, orders, or other business records in a separate seeded profile.
Each profile MUST declare baselineChecks: [{path:'/unfiltered-collection', query?:{input:'serialized protocol input'}, server?:'recipe-server', credential?:'provided-credential-name', counts:{'json.path.to.globalCount':0}, totals?:{'json.path.to.globalTotal':0}}]. Read the actual API and spec to name each instance-wide collection and its global count, not a page length or filtered count. Empty profiles require every count and total to equal zero. Seeded counts and totals must come from independently known authored inputs. The runner boots the real app and executes these reads itself before and after your verifier; your script's marker cannot substitute for them. These non-secret expected values are visible to scenario authors. Use query for required transport parameters, such as tRPC's serialized input. Query presence or absence does not prove global scope: inspect the endpoint and omit business filters. A global count may be nested in result.data.json.count. If the app exposes no supported unfiltered JSON observation of its baseline, report that limitation instead of fabricating a check.
The seed, verify and optional cleanup fields are Node ES-module source. Scripts receive GUARD_REPO_ROOT, GUARD_PREPARATION_DIRECTORY, GUARD_PREPARATION_NAMESPACE, GUARD_PREPARATION_BASELINE. Import application modules dynamically using GUARD_REPO_ROOT; source and final script directories differ. Seed uses the app's own provisioning path and writes the established {credentials:{name:{value}},fixtures:{name:{field:value}}} JSON to GUARD_SEED_OUT. Publish all required fields and credential header/server metadata through provides. Input amounts/dates/categories must be known independently, never copied from aggregate outputs. PostgreSQL seed and cleanup additionally receive GUARD_PREPARATION_POSTGRES_BASE_URLS, a JSON map from the declared URL env names to their original resolved URLs. Use the original direct connection only to create/drop the exact allocated database. Require /^guard_[a-f0-9]{32}$/ for that identifier and quote it; never interpolate an unchecked name. Create a fresh database from template0, apply the app's noninteractive deploy migrations against the PRIVATE direct URL, then import app code and seed using private URLs. Check that all selected connection routes reach the same owned database. A missing CREATEDB privilege is an explicit preparation finding. Never rewrite migrations, use db push instead of migrations, copy shared mutable rows, or reuse shared sessions. Cleanup is mandatory for PostgreSQL, disconnects clients, drops only that database and tolerates creation never having succeeded. Do not log or publish base/private URLs or passwords.
verify receives the primary environment plus the following required JSON inputs. Start the verifier with this input parsing code, before starting either app:
${PREPARATION_VERIFY_INPUTS_SOURCE}
Use requiredPreparationCredential(credentials, 'actual-provided-name') for primary authentication and requiredPreparationCredential(peerCredentials, 'actual-provided-name') for peer authentication. Never default missing JSON to {}, reuse primary credentials for the peer, or send an undefined credential header. Missing inputs must fail explicitly before any requests. The verifier receives port templates intact. Allocate each app port and replace every \${PORT} template in its environment with that port before importing app configuration or spawning a server. Start both actual apps on free ports with their respective environments; authenticate through these private credentials. Assert empty/seeded baseline and exact independent expected values through the app. Prove the provided session authenticates and the promised document/resource status and relations exist through real app reads. Publish numeric legacy IDs and envelope IDs as distinct fixture fields when the app uses both. Mutate the PEER, then prove primary unchanged at its declared baseline. Stop every process before exiting. Only after these assertions pass write {fixtures:{verification:{baseline:'empty' or 'seeded',isolated:true}}} to GUARD_SEED_OUT. Do not just emit this marker; the observations are the proof. A broken aggregate or false isolation must fail. Cleanup must use only its provided owned namespace/directory and never a default/shared reset. It runs even after seed failed before publishing a manifest.
Call verify_preparations with nonempty profiles and repair failures. A verification error is a failed preparation, not evidence that isolation is unsupported; do not discard failed profiles and return only findings. Return exact verified profiles and findings. Existing profiles need edits only when their configuration or script actually needs repair.`;
