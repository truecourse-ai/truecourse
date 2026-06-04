import { spawn, sync as spawnSync } from 'cross-spawn';
import { isLikelyAuthFailure } from '@truecourse/spec-consolidator';

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
 * Outcome of a live `claude` CLI preflight.
 *   - `not-found`        binary isn't installed / on PATH
 *   - `unauthenticated`  the login is missing or expired (the common case)
 *   - `error`            the binary ran but failed for some other reason
 */
export type ClaudeAuthResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'unauthenticated' | 'error'; detail?: string };

export interface CheckClaudeAuthOptions {
  /** Per-call timeout for the probe. Defaults to 60s. */
  timeoutMs?: number;
}

/**
 * Classify a probe subprocess's outcome. Pure so the policy is unit-tested
 * without spawning.
 *
 * A non-zero exit on a trivial one-token prompt almost always means the login
 * is gone — and an expired Claude login frequently exits with an *empty*
 * stderr (so the message-pattern heuristic can't see it). We therefore treat
 * "non-zero exit with nothing on stderr" as an auth problem, while a non-zero
 * exit that *does* print something non-auth-looking is surfaced verbatim so the
 * real error isn't masked.
 */
export function classifyClaudeProbe(code: number | null, stderr: string): ClaudeAuthResult {
  if (code === 0) return { ok: true };
  const detail = stderr.trim();
  const looksAuth = detail === '' || isLikelyAuthFailure(`claude exited ${code}: ${detail}`);
  return {
    ok: false,
    reason: looksAuth ? 'unauthenticated' : 'error',
    detail: detail || undefined,
  };
}

/**
 * Live preflight for the `claude` CLI: confirm it's installed AND that the
 * stored login still works, by issuing one tiny `claude -p` round-trip. Used to
 * fail fast before a spec scan fans out hundreds of extraction subprocesses —
 * an expired login makes every one of them error, and without this gate the
 * user only learns that at the very end of a long run.
 *
 * The binary is resolved the same way the extraction runners resolve it
 * (`CLAUDE_CODE_BIN`, else `claude` on PATH) so the probe and the real work
 * agree on which binary they're testing.
 *
 * A timeout or a post-spawn hiccup resolves to `{ ok: true }` (inconclusive):
 * the probe shouldn't block a legitimate scan over a slow network.
 */
export function checkClaudeAuth(
  binary: string = process.env.CLAUDE_CODE_BIN ?? 'claude',
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
    const proc = spawn(binary, ['-p', 'Reply with the single word: ok', '--output-format', 'json'], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const stderr: Buffer[] = [];
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

    proc.stderr?.on('data', (b: Buffer) => stderr.push(b));
    // Already passed the availability check, so a spawn-time error here is an
    // environmental hiccup, not a definitive auth failure — don't block.
    proc.on('error', () => finish({ ok: true }));
    proc.on('close', (code) =>
      finish(classifyClaudeProbe(code, Buffer.concat(stderr).toString('utf-8'))),
    );
  });
}
