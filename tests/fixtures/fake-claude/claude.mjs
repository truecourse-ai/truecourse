#!/usr/bin/env node
/**
 * A fake `claude -p` binary: the seam that lets a test drive the REAL cli
 * transport — the one production uses when no other transport is installed, and
 * therefore the only path on which the engine's own runner construction is
 * exercised. A test that injects runners never reaches it, which is exactly how a
 * whole stage failing to spawn went unnoticed. It covers the ONE-SHOT stages
 * only; agent sessions never spawn a binary through this transport.
 *
 * Point `CLAUDE_CODE_BINARY` at this file and it answers every stage from a script:
 *
 *   FAKE_CLAUDE_SCRIPT  path to a JSON object { "<stage>": [ { match?, reply } ] }
 *                       — the first entry whose `match` string appears in the user
 *                       prompt answers (an entry with no `match` always answers).
 *   FAKE_CLAUDE_LOG     NDJSON call log: { stage, model, match } per call.
 *
 * The stage is identified by EXACT system-prompt identity, read from the engine's
 * own exported constants, so a reworded prompt can never silently mis-dispatch.
 * Anything unscripted exits 1 with the reason on stderr — the transport surfaces it
 * as a stage failure rather than a quiet wrong answer.
 */

import fs from 'node:fs';
import { MATCH_SYSTEM_PROMPT, RECIPE_SYSTEM_PROMPT } from '@truecourse/guard-generator';

/**
 * The `claude -p` ONE-SHOT stages guard generate still has (plan 04 step 20).
 * Claim extraction, flow synthesis, authoring, fidelity review and triage are
 * agent SESSIONS now (or gone): they never spawn this binary, so scripting them
 * here would only advertise a path that no longer exists. A test that needs a
 * session scripted drives the session DRIVER instead (see
 * `tests/core/guard-generate-*.test.ts`).
 */
const STAGE_BY_SYSTEM = new Map([
  [MATCH_SYSTEM_PROMPT, 'guard.match'],
  [RECIPE_SYSTEM_PROMPT, 'guard.recipe'],
]);

function die(message) {
  process.stderr.write(`fake-claude: ${message}\n`);
  process.exit(1);
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

// Stand-in for the real binary means standing in for its PREFLIGHT too: the
// provider gates spawn `claude --version` and treat a non-zero exit as "not
// installed", so a fake that only understood `-p` would fail every gate it is
// pointed at — as itself, not as the missing binary a test meant to simulate.
if (process.argv.includes('--version')) {
  process.stdout.write('0.0.0-fake (fake-claude)\n');
  process.exit(0);
}

const system = argValue('--system-prompt');
if (system === undefined) die('no --system-prompt');
const model = argValue('--model') ?? '';
const user = await readStdin();

const stage = STAGE_BY_SYSTEM.get(system);
if (!stage) die('unrecognized system prompt — no stage owns it');

const scriptPath = process.env.FAKE_CLAUDE_SCRIPT;
if (!scriptPath) die('FAKE_CLAUDE_SCRIPT is unset');
const script = JSON.parse(fs.readFileSync(scriptPath, 'utf-8'));

const entries = script[stage];
if (!entries) die(`no scripted answer for stage ${stage}`);
const entry = entries.find((e) => e.match === undefined || user.includes(e.match));
if (!entry) die(`no scripted answer for stage ${stage} matching this prompt`);

if (process.env.FAKE_CLAUDE_LOG) {
  fs.appendFileSync(
    process.env.FAKE_CLAUDE_LOG,
    JSON.stringify({ stage, model, match: entry.match ?? null }) + '\n',
  );
}

// The stream-json shape the transport parses: at least one lifecycle event, then
// the terminal `result` envelope carrying the answer text.
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init' }) + '\n');
process.stdout.write(
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: JSON.stringify(entry.reply),
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    total_cost_usd: 0,
  }) + '\n',
);
