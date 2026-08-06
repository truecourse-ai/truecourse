#!/usr/bin/env node
/**
 * A fake `claude -p` binary: the seam that lets a test drive the REAL cli
 * transport — the one production uses when no other transport is installed, and
 * therefore the only path on which the engine's own runner construction is
 * exercised. A test that injects runners never reaches it, which is exactly how a
 * whole stage failing to spawn went unnoticed.
 *
 * Point `CLAUDE_CODE_BINARY` at this file and it answers every stage from a script:
 *
 *   FAKE_CLAUDE_SCRIPT  path to a JSON object { "<stage>": [ { match?, turn?, reply?, replyText? } ] }
 *                       — the first entry whose filters pass answers: `match` is a
 *                       substring of the user prompt (absent = any), `turn` is the
 *                       session's 0-based turn index (absent = any). `reply` is a
 *                       JSON value the envelope stringifies (one-shot stages);
 *                       `replyText` is raw assistant text (turn protocol replies).
 *   FAKE_CLAUDE_LOG     NDJSON call log: { stage, model, match, sessionId, turn } per call.
 *   FAKE_CLAUDE_SESSIONS  directory for per-session turn counters. Required for
 *                       `turn`-filtered entries to see indexes > 0: each answered
 *                       call with a session id bumps `<dir>/<sid>.turn`.
 *
 * The turn protocol (`--session-id <id>` on the first turn, `--resume <id>` after)
 * mirrors the real binary: the result envelope echoes the session id, and the
 * conversation state is the session — dispatch stays on session id + system prompt.
 *
 * The stage is identified by EXACT system-prompt identity, read from the engine's
 * own exported constants, so a reworded prompt can never silently mis-dispatch.
 * Anything unscripted exits 1 with the reason on stderr — the transport surfaces it
 * as a stage failure rather than a quiet wrong answer.
 */

import fs from 'node:fs';
import {
  EXTRACT_SYSTEM_PROMPT,
  FLOWS_SYSTEM_PROMPT,
  FLOWS_EPIC_SYSTEM_PROMPT,
  MATCH_SYSTEM_PROMPT,
  GENERATE_SYSTEM_PROMPT,
  GENERATE_API_SYSTEM_PROMPT,
  FIDELITY_SYSTEM_PROMPT,
  TRIAGE_SYSTEM_PROMPT,
  RECIPE_SYSTEM_PROMPT,
  SEED_SYSTEM_PROMPT,
} from '@truecourse/guard-generator';

// Authoring and its evidence retry share one system prompt (one runner, one
// contract), so both answer under `guard.generate`.
const STAGE_BY_SYSTEM = new Map([
  [EXTRACT_SYSTEM_PROMPT, 'guard.extract'],
  [FLOWS_SYSTEM_PROMPT, 'guard.flows'],
  [FLOWS_EPIC_SYSTEM_PROMPT, 'guard.flows.epic'],
  [MATCH_SYSTEM_PROMPT, 'guard.match'],
  [GENERATE_SYSTEM_PROMPT, 'guard.generate'],
  [GENERATE_API_SYSTEM_PROMPT, 'guard.generate.api'],
  [FIDELITY_SYSTEM_PROMPT, 'guard.fidelity'],
  [TRIAGE_SYSTEM_PROMPT, 'guard.triage'],
  [RECIPE_SYSTEM_PROMPT, 'guard.recipe'],
  [SEED_SYSTEM_PROMPT, 'guard.seed'],
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

// The turn protocol's session identity: minted by `--session-id`, carried
// forward by `--resume`. One-shot calls have neither and no turn state.
const sessionId = argValue('--resume') ?? argValue('--session-id');
const sessionsDir = process.env.FAKE_CLAUDE_SESSIONS;
const turnPath =
  sessionId && sessionsDir ? `${sessionsDir}/${sessionId.replace(/[^A-Za-z0-9-]/g, '_')}.turn` : undefined;
const turnIndex = turnPath && fs.existsSync(turnPath) ? parseInt(fs.readFileSync(turnPath, 'utf-8'), 10) || 0 : 0;

// The worker system prompt ends with the loop's action-protocol block; match
// stage constants as prefixes so both the bare prompt and the composed one
// dispatch to the same stage.
let stage = STAGE_BY_SYSTEM.get(system);
if (!stage) {
  for (const [prompt, name] of STAGE_BY_SYSTEM) {
    if (system.startsWith(prompt)) {
      stage = name;
      break;
    }
  }
}
if (!stage) die('unrecognized system prompt — no stage owns it');

const scriptPath = process.env.FAKE_CLAUDE_SCRIPT;
if (!scriptPath) die('FAKE_CLAUDE_SCRIPT is unset');
const script = JSON.parse(fs.readFileSync(scriptPath, 'utf-8'));

const entries = script[stage];
if (!entries) die(`no scripted answer for stage ${stage}`);
const entry = entries.find(
  (e) =>
    (e.match === undefined || user.includes(e.match)) &&
    (e.turn === undefined || e.turn === turnIndex),
);
if (!entry) die(`no scripted answer for stage ${stage} matching this prompt (turn ${turnIndex})`);

if (turnPath) {
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(turnPath, String(turnIndex + 1));
}

if (process.env.FAKE_CLAUDE_LOG) {
  fs.appendFileSync(
    process.env.FAKE_CLAUDE_LOG,
    JSON.stringify({
      stage,
      model,
      match: entry.match ?? null,
      // Session fields appear only on turn-protocol calls, so one-shot
      // consumers keep their exact log shape.
      ...(sessionId ? { sessionId, turn: turnIndex } : {}),
    }) + '\n',
  );
}

// The stream-json shape the transport parses: at least one lifecycle event, then
// the terminal `result` envelope carrying the answer text. `replyText` answers
// verbatim (turn protocol); `reply` is a JSON value the envelope stringifies.
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: sessionId }) + '\n');
process.stdout.write(
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: typeof entry.replyText === 'string' ? entry.replyText : JSON.stringify(entry.reply),
    session_id: sessionId,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    total_cost_usd: 0,
  }) + '\n',
);
