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
  RecipeSchema,
  prepareScenario,
  recipePath,
  runBuild,
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
          baselineChecks: RecipePreparationSchema.shape.baselineChecks.unwrap(),
          env: RecipePreparationSchema.shape.env,
          seed: z.string().min(1),
          provides: RecipePreparationSchema.shape.seed.shape.provides,
          verify: z.string().min(1),
          cleanup: z.string().min(1).optional(),
        })
        .strict(),
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
        baselineChecks: draftProfile.baselineChecks,
        env: draftProfile.env,
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
    try {
      const build = await runBuild(
        input.repoRoot,
        input.recipe.build,
        input.recipe.env,
        600_000,
        opts.signal,
      );
      if (!build.ok)
        return {
          status: 'failed',
          reason:
            'Application build failed before private preparation verification',
        };
      if (input.recipe.api?.services) {
        const up = await runBuild(
          input.repoRoot,
          input.recipe.api.services.up,
          input.recipe.env,
          600_000,
          opts.signal,
        );
        if (!up.ok)
          return {
            status: 'failed',
            reason:
              'Shared services failed before private preparation verification',
          };
        servicesStarted = true;
      }
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
              try {
                await verifyPreparationDraft(input, draft, {
                  signal: opts.signal,
                });
                verified = identity(draft);
                return {
                  content:
                    'Private baseline and cross-world independence verified through the application.',
                };
              } catch (error) {
                return {
                  content: `Preparation verification refused: ${error instanceof Error ? error.message : String(error)}`,
                  isError: true,
                };
              }
            },
          }),
        ],
        outcomeSchema: PreparationDraftSchema,
        validateOutcome(outcome) {
          return outcome.profiles.length > 0 && identity(outcome) !== verified
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
          reason: describeSessionFailure(result.failure),
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
        reason: error instanceof Error ? error.message : String(error),
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
Use named profiles with baseline empty or seeded, instance scope, and environment bindings using \${directory} or \${namespace}. For SQLite use the app's supported path variable pointing inside \${directory}. No fabricated universal PostgreSQL/MySQL isolation or global resets.
An empty profile contains ZERO business records. Provision schema and required credentials only; never copy the main seed's business fixtures into it. Keep example expenses, orders, or other business records in a separate seeded profile.
Each profile MUST declare baselineChecks: [{path:'/unfiltered-collection', server?:'recipe-server', credential?:'provided-credential-name', counts:{'json.path.to.globalCount':0}, totals?:{'json.path.to.globalTotal':0}}]. Read the actual API and spec to name each instance-wide collection and its global count, not a page length or filtered count. Empty profiles require every count and total to equal zero. Seeded counts and totals must come from independently known authored inputs. The runner boots the real app and executes these reads itself before and after your verifier; your script's marker cannot substitute for them. These non-secret expected values are visible to scenario authors. If the app exposes no supported unfiltered JSON observation of its baseline, report that limitation instead of fabricating a check.
The seed, verify and optional cleanup fields are Node ES-module source. Scripts receive GUARD_REPO_ROOT, GUARD_PREPARATION_DIRECTORY, GUARD_PREPARATION_NAMESPACE, GUARD_PREPARATION_BASELINE. Import application modules dynamically using GUARD_REPO_ROOT; source and final script directories differ. Seed uses the app's own provisioning path and writes the established {credentials:{name:{value}},fixtures:{name:{field:value}}} JSON to GUARD_SEED_OUT. Publish all required fields and credential header/server metadata through provides. Input amounts/dates/categories must be known independently, never copied from aggregate outputs.
verify receives primary environment, GUARD_PREPARATION_PEER_ENV JSON, GUARD_PREPARATION_FIXTURES and PEER_FIXTURES, GUARD_PREPARATION_CREDENTIALS and PEER_CREDENTIALS. Start both actual apps on free ports with their respective environments; authenticate through these private credentials. Assert empty/seeded baseline and exact independent expected values through the app. Mutate the PEER, then prove primary unchanged at its declared baseline. Stop every process before exiting. Only after these assertions pass write {fixtures:{verification:{baseline:'empty' or 'seeded',isolated:true}}} to GUARD_SEED_OUT. Do not just emit this marker; the observations are the proof. A broken aggregate or false isolation must fail. Cleanup must use only its provided owned namespace/directory and never a default/shared reset. It runs even after seed failed before publishing a manifest.
Call verify_preparations and repair failures. Return exact verified profiles and findings. Existing profiles need edits only when their configuration or script actually needs repair.`;
