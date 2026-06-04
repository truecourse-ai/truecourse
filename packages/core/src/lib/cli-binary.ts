import { spawn, sync as spawnSync } from 'cross-spawn';
import { resolveClaudeBinary } from '@truecourse/shared';

export function isCliBinaryAvailable(binary: string): boolean {
  // cross-spawn resolves Windows `.cmd`/`.ps1` shims to their underlying
  // executable directly, sidestepping both the CVE-2024-27980 spawn
  // restriction and the DEP0190 deprecation that fires when shell:true is
  // combined with an args array.
  const result = spawnSync(binary, ['--version'], {
    stdio: 'ignore',
    timeout: 5_000,
  });
  return result.status === 0;
}

/**
 * Build the env a `claude` child should run with. Mirrors the LLM provider's
 * hygiene (`CliProvider.getCleanEnv`): strip our own `CLAUDE_CODE*` /
 * `CLAUDE_INTERNAL*` vars so the probe spawns `claude` exactly the way real
 * calls do and our config can't leak into the child process.
 */
function cleanClaudeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('CLAUDE_CODE') || key.startsWith('CLAUDE_INTERNAL')) {
      delete env[key];
    }
  }
  return env;
}

/**
 * Outcome of a live `claude` CLI preflight.
 *   - `not-found`  binary isn't installed / on PATH (no output to show)
 *   - `failed`     the binary ran but exited non-zero; `output` is exactly what
 *                  `claude` printed (stdout + stderr), surfaced verbatim. We do
 *                  not try to guess *why* it failed — the CLI's own message is
 *                  more accurate than any heuristic we'd apply.
 */
export type ClaudeAuthResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'failed'; code: number | null; output: string };

export interface CheckClaudeAuthOptions {
  /** Per-call timeout for the probe. Defaults to 60s. */
  timeoutMs?: number;
}

/**
 * Package a probe subprocess's outcome. Pure so it's unit-tested without
 * spawning. A clean exit is success; any non-zero exit carries `claude`'s raw
 * output through verbatim so the caller can show the user exactly what the CLI
 * said rather than a guess.
 */
export function classifyClaudeProbe(code: number | null, output: string): ClaudeAuthResult {
  if (code === 0) return { ok: true };
  return { ok: false, reason: 'failed', code, output: output.trim() };
}

/**
 * Live preflight for the `claude` CLI: confirm it's installed AND that the
 * stored login still works, by issuing one tiny `claude -p` round-trip. Used to
 * fail fast before a spec scan fans out hundreds of extraction subprocesses —
 * an expired login makes every one of them error, and without this gate the
 * user only learns that at the very end of a long run.
 *
 * The binary is resolved via {@link resolveClaudeBinary} — the same precedence
 * every command and runner uses — so the probe and the real work always agree
 * on which binary they're testing.
 *
 * A timeout or a post-spawn hiccup resolves to `{ ok: true }` (inconclusive):
 * the probe shouldn't block a legitimate scan over a slow network.
 */
export function checkClaudeAuth(
  binary: string = resolveClaudeBinary(),
  options: CheckClaudeAuthOptions = {},
): Promise<ClaudeAuthResult> {
  // Cheap synchronous existence check first — no point paying for a round trip
  // when the binary isn't even on PATH.
  if (!isCliBinaryAvailable(binary)) {
    return Promise.resolve({ ok: false, reason: 'not-found' });
  }

  const timeoutMs = options.timeoutMs ?? 60_000;
  return new Promise<ClaudeAuthResult>((resolve) => {
    // A one-token reply is the cheapest call that still exercises the real auth
    // path (token validity, not just binary presence). No `--model` so we use
    // the account default and never false-fail on a model-availability quirk.
    // Plain (non-JSON) output so a failure surfaces `claude`'s own human-readable
    // message rather than a structured envelope.
    const proc = spawn(binary, ['-p', 'Reply with the single word: ok'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: cleanClaudeEnv(),
    });
    // Capture both streams: `claude` prints its reply on stdout and its errors
    // on stderr (and sometimes the reverse), so we keep everything and let the
    // caller show it verbatim instead of inferring a cause.
    const output: Buffer[] = [];
    let settled = false;
    const finish = (r: ClaudeAuthResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      finish({ ok: true });
    }, timeoutMs);

    proc.stdout?.on('data', (b: Buffer) => output.push(b));
    proc.stderr?.on('data', (b: Buffer) => output.push(b));
    // Already passed the availability check, so a spawn-time error here is an
    // environmental hiccup, not a definitive auth failure — don't block.
    proc.on('error', () => finish({ ok: true }));
    proc.on('close', (code) =>
      finish(classifyClaudeProbe(code, Buffer.concat(output).toString('utf-8'))),
    );
  });
}
