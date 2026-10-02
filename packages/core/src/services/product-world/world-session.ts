/**
 * THE WORLD SESSION — `guard-setup.world`.
 *
 * One session with a shell in the checkout gets the product running from its
 * source and leaves behind the three scripts that do it again without a model:
 * `world/build.sh`, `world/up.sh`, `world/down.sh` (the contract is
 * `@truecourse/shared`'s `guard/world.ts`). How a product is installed, what it
 * needs beside it, how it is migrated and how many processes it is are all the
 * session's to find out, the way an engineer new to the repository would: by
 * reading it and trying.
 *
 * The world it leaves is BARE. No test account and no sample data: flows are
 * synthesized after setup, so nobody yet knows what a test will start from,
 * and each test's own seed creates that when the test is written.
 *
 * The engine holds the result to one thing, `verify_world`: its own build and
 * boot of those scripts (`@truecourse/guard-runner`'s `product-world.ts`), the
 * same call every later run makes. An outcome is accepted only when that
 * passed on the scripts as they stand, so what the session reports and what a
 * run will get cannot differ.
 *
 * Needs a backend that can hand a session a shell, which is Claude Code.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  COMPUTER_TOOLS,
  defineSessionKind,
  defineToolSpec,
  type SessionDef,
  type SessionTool,
} from '@truecourse/agent-loop';
import {
  bootProductWorld,
  buildProductWorld,
  missingWorldScripts,
  worldScriptEnv,
  type WorldSlot,
} from '@truecourse/guard-runner';
import { WORLD_ENV, type ProductWorld } from '@truecourse/shared';
import { WORLD_SCRIPTS, worldDir, worldScriptPath } from '@truecourse/shared/work-tree';

export const WORLD_SESSION_KIND = 'guard-setup.world';

/** The world directory as a session names it: relative to the checkout it works in. */
const WORLD_REL = path.relative(path.sep, worldDir(path.sep));

/**
 * Getting an unfamiliar product to run is long work: reading, an install, a
 * build, several attempts at the boot. The turn grant is sized for that, and
 * the context ceiling is the backend's own, which compacts as it goes.
 */
export const WORLD_SESSION_BUDGET = { turns: 150, maxResumes: 1, tokenCeiling: 2_000_000 } as const;

/** The session's whole wall clock: installs and builds of real products are slow. */
export const WORLD_SESSION_TIMEOUT_MS = 2 * 60 * 60_000;

export const WorldSessionOutcomeSchema = z.object({
  /** What the product is and how the scripts run it, in a few sentences. */
  summary: z.string().min(1),
  /** What of the product is NOT running (a third-party account nobody has), one line each. */
  notRunning: z.array(z.string().min(1)).default([]),
});
export type WorldSessionOutcome = z.infer<typeof WorldSessionOutcomeSchema>;

const WORLD_SESSION = defineSessionKind({
  kind: WORLD_SESSION_KIND,
  outcomeSchema: WorldSessionOutcomeSchema,
});

export interface WorldSessionInput {
  repoRoot: string;
  /** The world's identity on this host; the scripts get it as their environment. */
  slot: WorldSlot;
  /** The documents the product's tests will be written from, so the session knows which product they describe. */
  documents: ReadonlyArray<{ path: string; title: string }>;
  signal?: AbortSignal;
}

/** What `verify_world` last established, kept for the outcome check. */
interface Verified {
  scripts: string;
  world: ProductWorld;
}

/** A session's view of its own verification, for the caller that folds the outcome. */
export interface WorldSessionState {
  /** The world the last passing `verify_world` reported, when the scripts have not changed since. */
  verified(): ProductWorld | undefined;
}

export function worldSessionDef(input: WorldSessionInput): { def: SessionDef<WorldSessionOutcome>; state: WorldSessionState } {
  let verified: Verified | undefined;
  const standing = (): ProductWorld | undefined =>
    verified && verified.scripts === scriptsHash(input.repoRoot) ? verified.world : undefined;

  const def: SessionDef<WorldSessionOutcome> = {
    ...WORLD_SESSION,
    reasoning: 'high',
    display: {
      title: 'Product world',
      intro: "I'm getting the product running from its source and writing the scripts that bring it up and down.",
    },
    systemPrompt: SYSTEM_PROMPT,
    computer: {
      cwd: input.repoRoot,
      tools: COMPUTER_TOOLS,
      env: worldScriptEnv(input.repoRoot, input.slot),
    },
    tools: [
      verifyWorldTool(input, (result) => {
        verified = result;
      }),
    ],
    budget: WORLD_SESSION_BUDGET,
    outcomePrecondition: {
      tool: VERIFY_WORLD.name,
      message:
        'Outcome refused: `verify_world` has not run in this session. It is the engine building and booting your scripts exactly as every later run will. Run it, fix what it reports, then give the outcome.',
    },
    validateOutcome: () =>
      standing()
        ? undefined
        : 'Outcome refused: the scripts are not the ones `verify_world` last passed (it failed, or they changed since). Run `verify_world` on them as they are now.',
  };
  return { def, state: { verified: standing } };
}

/** One hash over the three scripts as they are on disk; a missing one counts. */
function scriptsHash(repoRoot: string): string {
  const hash = createHash('sha256');
  for (const script of WORLD_SCRIPTS) {
    let body = '';
    try {
      body = fs.readFileSync(worldScriptPath(repoRoot, script), 'utf-8');
    } catch {
      /* a script not written yet */
    }
    hash.update(`${script}\0${body}\0`);
  }
  return hash.digest('hex');
}

const VERIFY_WORLD = defineToolSpec({
  name: 'verify_world',
  description:
    'The engine runs YOUR scripts the way every later run will: `world/build.sh`, then `world/up.sh`, then it reads the world file and checks that `baseUrl` answers, then `world/down.sh`. Returns what was established or the stage that failed with what that script printed. Slow (a real build and boot). Stop anything you started by hand first: it binds the same ports.',
  kind: 'verify-world',
  readOnly: false,
  destructive: false,
  inputSchema: z.object({}).strict(),
});

function verifyWorldTool(input: WorldSessionInput, record: (verified: Verified | undefined) => void): SessionTool {
  return VERIFY_WORLD.bind({
    async execute(_args, ctx) {
      record(undefined);
      const missing = missingWorldScripts(input.repoRoot);
      if (missing.length > 0) {
        return { content: `Not written yet: ${missing.map((s) => `${WORLD_REL}/${s}.sh`).join(', ')}.`, isError: true };
      }
      const scripts = scriptsHash(input.repoRoot);
      const build = await buildProductWorld(input.repoRoot, { slot: input.slot, signal: ctx.signal });
      if (!build.ok) {
        const how = build.timedOut ? 'did not finish in time' : `exited ${build.exitCode ?? 'without a code'}`;
        return { content: `FAILED at build: world/build.sh ${how}.\n\n${build.output}`, isError: true };
      }
      const boot = await bootProductWorld(input.repoRoot, { slot: input.slot, signal: ctx.signal });
      if (!boot.ok) return { content: `FAILED at ${boot.stage}: ${boot.reason}`, isError: true };
      const down = await boot.running.down();
      if (!down.ok) {
        return { content: `The product came up and answered, then world/down.sh exited ${down.exitCode ?? 'without a code'}:\n\n${down.output}`, isError: true };
      }
      const { world } = boot.running;
      record({ scripts, world });
      return {
        content: [
          `PASSED. build, up, answer at ${world.baseUrl}, down.`,
          ...(world.accounts.length > 0
            ? [`accounts the installation made: ${world.accounts.map((a) => `${a.name}${a.role ? ` (${a.role})` : ''}`).join(', ')}`]
            : []),
          ...(Object.keys(world.urls).length > 0 ? [`urls: ${Object.entries(world.urls).map(([k, v]) => `${k}=${v}`).join(', ')}`] : []),
        ].join('\n'),
      };
    },
  });
}

export function worldSessionBriefing(input: WorldSessionInput): string {
  const documents = input.documents.slice(0, 60).map((d) => `- ${d.path}: ${d.title}`);
  return [
    `Get the product in this repository running and write its world scripts. The checkout is your working directory: ${input.repoRoot}`,
    '',
    'Your shell already has the environment the scripts will be given:',
    `- ${WORLD_ENV.id}=${input.slot.id}`,
    `- ${WORLD_ENV.ports}=${input.slot.ports.join(' ')}`,
    `- ${WORLD_ENV.stateFile} and ${WORLD_ENV.logsDir} point inside ${WORLD_REL}/`,
    '',
    input.documents.length > 0
      ? `The tests that will run against this world are written from these documents. They tell you WHICH product in the repository matters (${input.documents.length} in all${input.documents.length > documents.length ? `, first ${documents.length} shown` : ''}):`
      : 'No document list is available; the product is whatever this repository exists to ship.',
    ...documents,
  ].join('\n');
}

const SYSTEM_PROMPT = `You get a software product running from its source checkout, and you leave behind three shell scripts that do it again without you. Tests will then be written against the running product, by other sessions, from the product's documentation.

You have a real shell in the checkout. Work the way a capable engineer new to the repository would: read the README, the manifests, the compose files, the env examples and the CI config; try things; read the errors.

# What you deliver

Three POSIX sh scripts, run from the repository root:

- \`${WORLD_REL}/build.sh\`: install dependencies and build. Runs once per fresh checkout. Everything slow and repeatable belongs here.
- \`${WORLD_REL}/up.sh\`: bring the WHOLE product up, from a built checkout, to the point where a first person could start using it: backing services, schema and migrations, every server the product is made of. It must not exit until the product answers, and then it writes the world file.
- \`${WORLD_REL}/down.sh\`: stop everything \`up.sh\` started and DISCARD its data (containers, volumes, database files), so the next \`up.sh\` starts from nothing. Safe to run when nothing is up.

# A bare product

\`up.sh\` leaves the product installed and EMPTY. It creates no test account, no sample data and no demo content, and it does not run the repository's development seed.

Nobody knows yet what the tests will need: each test is written later, from one documented flow, together with a seed of its own that creates exactly what that flow starts from. Data put in here would be shared by every test, and shared data is how tests break each other.

What \`up.sh\` does do is whatever the product needs before anyone can use it at all: its migrations, the reference data it cannot work without (the roles, plans or defaults its own installer or migrations create), and a one-time installation step if it has one. Where that installation itself makes an account (a default admin, a root user), that account exists and you report it; you do not make one otherwise.

# The contract the scripts are held to

They run with these variables, and nothing else of the host's environment beyond PATH, HOME and the usual toolchain variables:

- \`TC_WORLD_ID\`: a name unique to this world on this host. Name everything that outlives a script after it: \`docker compose -p "$TC_WORLD_ID"\`, container names, volumes. Never rely on a compose file's own project or container names: another copy of this product may be running on the same host.
- \`TC_PORTS\`: space-separated free ports. Bind NOTHING on the host that is not one of them, including ports containers publish. A compose file with fixed host ports needs an override file of yours (write it under \`${WORLD_REL}/\`) that maps to these. Pick them by position (\`set -- $TC_PORTS\`), so the same script works with any set.
- \`TC_WORLD_FILE\`: where \`up.sh\` writes the world file.
- \`TC_WORLD_LOGS\`: a directory for the output of whatever is left running.

Servers left running by \`up.sh\` are started in the background with their output redirected to a file in \`$TC_WORLD_LOGS\` (\`nohup … > "$TC_WORLD_LOGS/web.log" 2>&1 &\`). A background process still attached to the script's own output keeps the script from being seen to finish.

Run the product the way it is meant to be deployed where that is practical (a production build and start), not a watch-mode dev server: tests need it stable, not hot-reloading.

The scripts take their configuration from what they set themselves. Whatever the product reads (database URLs, its own public URL, secrets it needs to start) the scripts export or write, with the ports from \`TC_PORTS\`. Configure it so that a test can make its own accounts: sign-up open where the product has a switch for it, mail going to a local catcher.

# The world file

JSON, written by \`up.sh\` to \`$TC_WORLD_FILE\` once the product answers:

\`\`\`json
{
  "baseUrl": "http://localhost:<port>",
  "urls": { "api": "http://localhost:<port>", "mail": "http://localhost:<port>" },
  "accounts": [
    { "name": "admin", "role": "the administrator the installer creates", "email": "admin@example.com", "password": "…" }
  ],
  "notes": "what whoever writes a test's seed must know and the fields above cannot say"
}
\`\`\`

- \`baseUrl\` is where a person opens the product. \`urls\` names every other address it answers on.
- \`accounts\` lists ONLY accounts the product's own installation made, with credentials that really sign in. Most products make none: \`"accounts": []\`.
- \`notes\` is for the sessions that will write each test's seed. Say what you learned while bringing the product up that they would otherwise have to rediscover: how an account comes to exist (open sign-up, an invitation, a command), whether a new account must be verified and where that mail lands, and the exact command that reaches the datastore, written with the variable and not its value (\`docker compose -p "$TC_WORLD_ID" -f ${WORLD_REL}/compose.yml exec -T db psql -U app app\`). Tests run with \`TC_WORLD_ID\` set to this world's.
- If the product sends mail (verification, invitations, resets), run a local mail catcher beside it, point the product at it, and report its address as \`urls.mail\`.

# Limits

- Change nothing the repository ships. Your files live under \`${WORLD_REL}/\`: the three scripts, and any compose override or env file they use.
- Install nothing on the host: no global package installs, no \`sudo\`, nothing outside the checkout except containers and their volumes. If the product needs a toolchain the host lacks, run that part in a container.
- A third-party service that needs an account nobody has given you stays unconfigured. Bring up everything that does not depend on it, and name it in \`notRunning\`.
- The product is the one the documents describe. A repository often also holds a documentation site, a marketing site or examples: those are not it.

# How to work

1. Find out what the product is made of and how its own developers run it.
2. Get it running by hand in your shell. Your shell has the same \`TC_*\` variables the scripts get, so what works by hand works in the script.
3. Write the three scripts and run them yourself. See that the product answers, that an account the installation made really signs in, and that the datastore command in your notes really reaches it.
4. Stop what you started by hand, then call \`verify_world\`. It is the engine building and booting your scripts exactly as every later run will, and it reports the stage that failed with that script's own output. Fix and repeat until it passes.
5. Give the outcome: what the product is and how the scripts run it, and anything that is not running.

An outcome is accepted only when \`verify_world\` passed on the scripts as they are at that moment. If, after real effort, the product cannot be brought up, do not fake it with a stand-in server: there is no outcome to give, and the session ending without one is the honest result.`;
