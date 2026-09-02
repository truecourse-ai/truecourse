/**
 * THE AUTH VERIFICATION SESSION — `guard-setup.auth-proof`.
 *
 * The LAST setup step consumes the catalog's SUPPLIED entries — the real-world
 * state the engine must never fabricate (an authenticated config dir, an
 * external account's keys) — and PROVES each provided one actually works: the
 * runner materializes the registered instance into a fresh sandbox (the same
 * `materializeSupplied` copy-in every scenario uses) and one short session
 * runs the program against it until it has a proof or an honest blocker.
 *
 * PROOF-CLASS, so NO CACHE — verification's whole value is that it ran
 * against the live registration just now; a cached proof is a claim about a
 * key that may since have been rotated. Budget is tiny (5 turns, no resume):
 * a proof is one or two invocations and an excerpt.
 *
 * The step's verdict:
 *  - every provided entry proved       → `ok`;
 *  - an entry is unprovided/incomplete, or a session returned
 *    `{verdict: 'blocked', blocked: {registration}}` → `blocked` — LOUD and actionable
 *    (the reason names what to register where), and setup stays ok: this is
 *    the one step allowed to end that way;
 *  - a session failed outright          → `failed` (still soft — setup is ok).
 *
 * Sandbox-only observation, like the reconcile session: the tool cannot read
 * the repository, because the question is not "what does the code say" but
 * "does this machine's registration authenticate".
 */

import { z } from 'zod';
import {
  defineSessionTool,
  type SessionDef,
  type SessionEvent,
  type SessionTool,
} from '@truecourse/agent-loop';
import type { GuardSetupAuthStep, GuardSetupAuthStepInput } from '@truecourse/guard-generator';
import {
  createWorkingSandbox,
  buildCredentialRedactor,
  resolveDependencies,
  resolveEntry,
  type ResolvedDependency,
  type SuppliedInstance,
} from '@truecourse/guard-runner';
import { runSessionPool } from '../agent/session-pool.js';
import { describeSessionFailure, type GuardSetupSessionContext } from './session-context.js';

export const AUTH_PROOF_SESSION_KIND = 'guard-setup.auth-proof';

/** The three numbers: a proof is one or two `run_entry` observations
 *  and a short outcome — 5 turns, no resume, a low ceiling. */
export const AUTH_PROOF_BUDGET = { turns: 5, maxResumes: 0, tokenCeiling: 50_000 } as const;

const MAX_STREAM_CHARS = 6_000;
const RUN_ENTRY_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// The outcome
// ---------------------------------------------------------------------------

/**
 * A PROOF (the argv that demonstrated the authenticated state, plus the output
 * excerpt that shows it — quoted, redacted) or a BLOCKER (what a human must
 * register, in words they can act on). One object, discriminated by `verdict`,
 * carrying exactly the half that matches it — deliberately NOT a `z.union` or
 * `z.discriminatedUnion`: both render as a root-level `anyOf` JSON schema, and
 * the drivers hand this schema to provider surfaces that require an OBJECT
 * root (the api driver's injected `outcome` tool inputSchema, the Agent SDK
 * driver's `outputFormat` json-schema). The pairing the union used to encode
 * structurally is enforced by the `superRefine` instead — the loop parses
 * every outcome against this schema before completing a session, so a
 * verdict without its half fails `malformed` there.
 */
export const AuthProofOutcomeSchema = z
  .object({
    verdict: z.enum(['proved', 'blocked']),
    proof: z
      .object({
        argv: z.array(z.string()),
        /** The (already-redacted) output lines that demonstrate the auth held. */
        excerpt: z.string().min(1),
      })
      .strict()
      .optional(),
    blocked: z
      .object({
        /** What to register, where — actionable words for the person who owns the account. */
        registration: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.verdict === 'proved') {
      if (!value.proof) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['proof'],
          message: 'verdict "proved" requires `proof` — the argv and excerpt that demonstrated it',
        });
      }
      if (value.blocked) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['blocked'],
          message: 'verdict "proved" must not carry `blocked`',
        });
      }
    } else {
      if (!value.blocked) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['blocked'],
          message: 'verdict "blocked" requires `blocked` — the registration a human must complete',
        });
      }
      if (value.proof) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['proof'],
          message: 'verdict "blocked" must not carry `proof`',
        });
      }
    }
  });
export type AuthProofOutcome = z.infer<typeof AuthProofOutcomeSchema>;

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

interface AuthProofItem {
  dependency: ResolvedDependency;
  instance: SuppliedInstance;
}

export function authProofSessionDef(input: {
  repoRoot: string;
  recipe: GuardSetupAuthStepInput['recipe'];
  item: AuthProofItem;
}): SessionDef<AuthProofOutcome> {
  return {
    kind: AUTH_PROOF_SESSION_KIND,
    display: {
      intro: `I'm proving that the supplied dependency \`${input.item.dependency.name}\` actually authenticates on this machine.`,
    },
    systemPrompt: AUTH_PROOF_SYSTEM_PROMPT,
    tools: [runEntryTool(input)],
    outcomeSchema: AuthProofOutcomeSchema,
    budget: AUTH_PROOF_BUDGET,
    // A proof that never ran the program proved nothing; a blocker without an
    // attempt is a guess. One observation minimum, structurally.
    outcomePrecondition: {
      tool: 'run_entry',
      message:
        'Outcome refused: you never ran `run_entry` in this session. A proof must show the program accepting the supplied state, and a blocker must show what the attempt hit — run it, then call `outcome` again.',
    },
  };
}

export function authProofBriefing(item: AuthProofItem, entry: readonly string[]): string {
  const { dependency, instance } = item;
  const layout =
    instance.kind === 'env'
      ? `env variables exported into the sandbox: ${Object.keys(instance.env ?? {}).join(', ') || '(none)'} (values registered on this machine, masked here)`
      : instance.kind === 'config-dir'
        ? `the registered directory is copied into the sandbox HOME at \`~/${instance.homePath}\``
        : `the registered path is copied into the sandbox at \`.tc-supplied/${instance.name}\``;
  return [
    `Prove that the supplied dependency \`${dependency.name}\` actually works on this machine.`,
    '',
    `## The catalog entry`,
    `- name: ${dependency.name}`,
    `- summary: ${dependency.entry.summary}`,
    `- requirement: ${dependency.requirement}`,
    '',
    `## The materialized state (already in every sandbox \`run_entry\` spawns)`,
    layout,
    '',
    `## The program`,
    `entry: ${entry.join(' ')} — \`run_entry\` appends your argv to it.`,
    '',
    'Run the cheapest command that can only succeed WITH this state (a `whoami`, a `status`, a list of the authenticated account\'s own resources). A clean, state-specific answer is your proof — quote its lines as the excerpt and return verdict `proved`. An authentication error, a missing-registration error, or a prompt for interactive login is a BLOCKER — return verdict `blocked` with the registration a human must complete, in their words. Do not guess either way: the output decides.',
  ].join('\n');
}

function runEntryTool(input: {
  repoRoot: string;
  recipe: GuardSetupAuthStepInput['recipe'];
  item: AuthProofItem;
}): SessionTool {
  // Secret env values of the registered instance must never enter a transcript
  // — the program may echo its environment or embed the key in an error URL.
  const secretValues = new Map<string, string>(
    Object.entries(input.item.instance.env ?? {}).map(([name, value]) => [
      `${input.item.dependency.name}.${name}`,
      value,
    ]),
  );
  const redact = buildCredentialRedactor(new Map(), secretValues);
  return defineSessionTool({
    name: 'run_entry',
    description:
      'Run the program under test with the given arguments, in a FRESH sandbox that already carries the materialized supplied state (env exported / files copied in). The argv is appended to the resolved entry — pass `["whoami"]`, never the binary path. Nothing persists between calls.',
    kind: 'run-entry',
    readOnly: false,
    destructive: false,
    inputSchema: z
      .object({
        argv: z.array(z.string()).describe('Arguments appended to the entry.'),
      })
      .strict(),
    async execute(args, toolCtx) {
      const sandbox = createWorkingSandbox({
        ...(input.recipe.env ? { recipeEnv: input.recipe.env } : {}),
        repoRoot: input.repoRoot,
        supplied: [input.item.instance],
      });
      try {
        const entry = resolveEntry(input.repoRoot, [...(input.recipe.entry ?? [])]);
        const capture = await sandbox.exec([...entry, ...args.argv], {
          timeoutMs: RUN_ENTRY_TIMEOUT_MS,
          ...(toolCtx.signal ? { signal: toolCtx.signal } : {}),
        });
        if (capture.spawnError) return { content: `spawn failed: ${capture.spawnError}`, isError: true };
        const lines = [
          `$ ${[...entry, ...args.argv].join(' ')}`,
          `exit: ${capture.exitCode === null ? `none (${capture.timedOut ? 'timed out' : `signal ${capture.signal ?? 'none'}`})` : capture.exitCode}`,
          '--- stdout ---',
          clip(capture.stdout),
          '--- stderr ---',
          clip(capture.stderr),
        ];
        return { content: redact(lines.join('\n')) };
      } catch (error) {
        return { content: redact(message(error)), isError: true };
      } finally {
        sandbox.cleanup();
      }
    },
  });
}

// ---------------------------------------------------------------------------
// The seam implementation the engine's auth step calls
// ---------------------------------------------------------------------------

export interface BuildAuthProofOptions {
  signal?: AbortSignal;
  concurrency?: number;
  onSessionEvent?: (workItem: string, event: SessionEvent) => void;
}

/** A ResolvedDependency (state `provided`) as the sandbox materializes it —
 *  the same mapping `suppliedInstancesFor` applies per scenario. */
function toSuppliedInstance(dep: ResolvedDependency): SuppliedInstance | null {
  const registration = dep.entry.registration;
  if (!registration) return null;
  if (registration.kind === 'env') {
    const optionalUnset = dep.requirements.filter((r) => r.optional && !r.resolved).map((r) => r.field);
    return {
      name: dep.name,
      kind: 'env',
      env: dep.env,
      ...(optionalUnset.length > 0 ? { optionalUnset } : {}),
    };
  }
  if (!dep.hostPath) return null;
  if (registration.kind === 'path') return { name: dep.name, kind: 'path', hostPath: dep.hostPath };
  return { name: dep.name, kind: 'config-dir', hostPath: dep.hostPath, homePath: registration.homePath };
}

/**
 * The `GuardSetupAuthStep` the command adapter injects: pool one proof session
 * per PROVIDED supplied entry (usually 1–2). NO cache — proof-class. Entries
 * nobody registered yet are `blocked` without spending a session: there is
 * nothing to materialize, and the actionable reason is the registration itself.
 */
export function buildAuthProof(
  context: GuardSetupSessionContext,
  opts: BuildAuthProofOptions = {},
): GuardSetupAuthStep {
  return async (input) => {
    try {
      const resolved = resolveDependencies(input.repoRoot);
      const supplied = resolved.dependencies.filter((d) => d.entry.class === 'supplied');
      if (supplied.length === 0) {
        return { status: 'skipped', reason: 'the catalog declares no supplied dependencies to verify' };
      }
      if (!input.recipe.entry || input.recipe.entry.length === 0) {
        return {
          status: 'skipped',
          reason:
            'the recipe declares no cli `entry` — supplied auth is proven by running the program, and there is nothing to run',
        };
      }

      const unregistered = supplied.filter((d) => d.state !== 'provided');
      const items: AuthProofItem[] = [];
      for (const dependency of supplied) {
        if (dependency.state !== 'provided') continue;
        const instance = toSuppliedInstance(dependency);
        if (instance) items.push({ dependency, instance });
      }

      const blockedReasons = unregistered.map(
        (d) => `${d.name}: not registered — ${d.requirement} (register in ${resolved.localPath})`,
      );

      let proved = 0;
      let failedSessions = 0;
      if (items.length > 0) {
        const { driver, persistence } = await context.acquire();
        const entry = resolveEntry(input.repoRoot, [...input.recipe.entry]);
        const results = await runSessionPool<AuthProofItem, AuthProofOutcome>({
          items,
          workItem: (item) => `auth:${item.dependency.name}`,
          session: (item) => authProofSessionDef({ repoRoot: input.repoRoot, recipe: input.recipe, item }),
          briefing: (item) => [authProofBriefing(item, entry)],
          driver,
          persistence,
          ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
          ...(opts.signal ? { signal: opts.signal } : {}),
          ...(opts.onSessionEvent ? { onSessionEvent: opts.onSessionEvent } : {}),
          fold: (item, outcome) => {
            // No repo/store writes here — the step ROW is the record, composed
            // below from these tallies.
            context.note(outcome.status === 'completed' ? 'completed' : 'failed');
            context.addSpend(1, outcome.spent);
            if (outcome.status !== 'completed') {
              failedSessions++;
              blockedReasons.push(`${item.dependency.name}: ${describeSessionFailure(outcome.failure)}`);
              return;
            }
            if (outcome.output.verdict === 'proved') {
              proved++;
            } else {
              // The schema's superRefine pairs `blocked` with the verdict, and
              // the loop parses every outcome before completing the session —
              // the half is present here.
              blockedReasons.push(`${item.dependency.name}: ${outcome.output.blocked!.registration}`);
            }
          },
        });
        void results;
      }

      const sessionRunId = context.runId();
      if (failedSessions > 0 && proved === 0 && blockedReasons.length === failedSessions) {
        return {
          status: 'failed',
          reason: blockedReasons.join('; '),
          ...(sessionRunId ? { sessionRunId } : {}),
        };
      }
      if (blockedReasons.length > 0) {
        return {
          status: 'blocked',
          reason: `${proved > 0 ? `${proved} proved · ` : ''}${blockedReasons.join('; ')}`,
          ...(sessionRunId ? { sessionRunId } : {}),
        };
      }
      return {
        status: 'ok',
        reason: `${proved} supplied dependenc${proved === 1 ? 'y' : 'ies'} proved against the registered state`,
        ...(sessionRunId ? { sessionRunId } : {}),
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
  if (text.length === 0) return '(empty)';
  if (text.length <= MAX_STREAM_CHARS) return text;
  return `${text.slice(0, MAX_STREAM_CHARS)}\n… clipped at ${MAX_STREAM_CHARS} of ${text.length} characters.`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const AUTH_PROOF_SYSTEM_PROMPT = `You verify SUPPLIED AUTH for TrueCourse guard: a user registered a real-world state on this machine (an authenticated config directory, an account's keys), and your one job is to PROVE the program under test can actually use it — or to name, precisely, what is still missing.

# The rules

- ONE window: \`run_entry\` runs the program in a fresh sandbox that already carries the materialized state. You cannot read the source, and you do not need to — the program's own output is the entire question.
- A PROOF is output that could only happen WITH the state: the authenticated account's identity, its own resources listed, a status that names the logged-in user. Quote the demonstrating lines verbatim as the excerpt (they are redacted before they reach you — quote what you see).
- A generic success proves nothing: \`--help\` working, a version string, an exit 0 on a command that never touches the account are not proofs. Prefer the cheapest command that FAILS without auth.
- A BLOCKER is output that shows the state does not authenticate: a 401/403, "not logged in", a prompt for interactive login, a missing variable named in an error. Return verdict \`blocked\` with the registration a human must complete — name the thing and where it goes, in their words, so the fix is one action.
- Never guess. Two or three observations at most; the budget is small because the question is small.

# The outcome

One object, \`verdict\` plus exactly the half that matches it:
- \`{verdict: "proved", proof: {argv, excerpt}}\` — the argv that demonstrated it and the quoted lines;
- \`{verdict: "blocked", blocked: {registration}}\` — the actionable registration text.
Never send both halves, and never send a verdict without its half.`;
