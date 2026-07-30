/**
 * Minimal-env child-process construction for guard execution.
 *
 * Every process guard spawns — scenario steps, the recipe build, the entrypoint
 * preflight probe — gets an env built from an ALLOWLIST, never a `...process.env`
 * spread. Only what a program legitimately needs reaches the child, so guard
 * outcomes are machine-independent and host secrets never leak into a build log,
 * a scenario transcript, or a subprocess a scenario might exfiltrate.
 *
 * Two shapes:
 *  - `sandbox` — the hermetic scenario env (redirected HOME/XDG/TMP + determinism
 *    pins). See `createSandbox`.
 *  - `passthrough` — the build/probe env: a NAMED allowlist of host vars copied by
 *    value (`BUILD_PASSTHROUGH`), for the broader needs of an install/build that
 *    runs against the real working tree.
 *
 * Deliberately EXCLUDED from `BUILD_PASSTHROUGH` (and never in the sandbox env):
 *  - `TRUECOURSE_*` (incl. `TRUECOURSE_SECRET_KEY`, the EE encryption master
 *    secret), `DATABASE_URL`, `GITHUB_APP_*`, LLM provider keys (`ANTHROPIC_API_KEY`
 *    and friends), `AWS_*` / other cloud creds — secrets the customer's build has
 *    no business seeing.
 *  - `NODE_ENV` — a platform value (e.g. `production`) would poison dev-dependency
 *    installs, so we let the build default it.
 *  - `npm_config_*` — artifacts of how THIS server process was launched, not the
 *    customer's intent; their real `.npmrc` travels via the real `HOME`.
 *  - `CI` — flips build tooling into surprising modes; a guard build should behave
 *    like a plain local build.
 */

import path from 'node:path'

/**
 * Determinism pins applied to every sandbox — the single source for both the
 * constructed child env and the evidence `envPins` record. Fixed, host-independent
 * values so output comparison is stable: UTC clock, C locale, colour off, fixed
 * terminal width.
 */
export const DETERMINISM_PINS: Readonly<Record<string, string>> = {
  TZ: 'UTC',
  LANG: 'C',
  NO_COLOR: '1',
  COLUMNS: '80',
}

/**
 * Host vars copied by value into the build/probe child. An install/build against
 * the real working tree legitimately needs identity, proxy/TLS config, and
 * toolchain roots — but nothing beyond this list. See the module doc comment for
 * what is deliberately excluded and why.
 */
export const BUILD_PASSTHROUGH = [
  // identity / system
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ',
  // proxy + TLS (corporate networks; installs die without these)
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  // package/toolchain caches + roots (real HOME covers .npmrc, ~/.cache, etc.)
  'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME',
  'NVM_DIR', 'VOLTA_HOME', 'ASDF_DIR', 'ASDF_DATA_DIR', 'PNPM_HOME', 'COREPACK_HOME',
  'CARGO_HOME', 'RUSTUP_HOME', 'GOPATH', 'GOCACHE', 'GOMODCACHE',
  'JAVA_HOME', 'DOTNET_ROOT', 'PYENV_ROOT',
] as const

export interface ChildEnvOptions {
  /** Redirected HOME/XDG/TMP roots (scenario sandbox) — omit for the build, which runs in the repo root. */
  sandbox?: { home: string; tmp: string }
  recipeEnv?: Record<string, string>
  scenarioEnv?: Record<string, string>
  /** Host vars to pass through by name (the build's broader needs). */
  passthrough?: readonly string[]
}

/**
 * The XDG dir layout inside a sandbox home. Shared so `createSandbox` can mkdir
 * exactly the paths `constructChildEnv` points the child's XDG_* vars at.
 */
export function sandboxXdgDirs(home: string): Record<string, string> {
  return {
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    XDG_RUNTIME_DIR: path.join(home, 'run'),
  }
}

/**
 * Build a child env from an allowlist. NEVER a `...process.env` spread — see the
 * module doc comment. Layering order everywhere: base allowlist → recipeEnv →
 * scenarioEnv → a cli step's own `env` ({@link overlayStepEnv}, the only layer
 * scoped to a single child) — later wins.
 */
export function constructChildEnv(opts: ChildEnvOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}

  if (opts.sandbox) {
    const { home, tmp } = opts.sandbox
    // PATH: programs must resolve node/git; the only host value that passes through.
    env.PATH = process.env.PATH ?? ''
    // Filesystem isolation: HOME + XDG + TMPDIR all redirected inside the sandbox
    // so no user config is read and no temp file lands on the real machine.
    env.HOME = home
    env.USERPROFILE = home
    env.TMPDIR = tmp
    Object.assign(env, sandboxXdgDirs(home))
    Object.assign(env, DETERMINISM_PINS)
    // Corepack resolves its cache under HOME (`os.homedir()` reads $HOME), so the
    // redirected sandbox home would make EVERY server boot re-download the pinned
    // yarn/pnpm — a network dependency and seconds of "! Corepack is about to
    // download…" stderr per scenario. The cache holds tool BINARIES, not user
    // config, so sharing the host's keeps the sandbox hermetic in the sense that
    // matters — the same reason PATH passes through.
    const corepack =
      process.env.COREPACK_HOME ??
      (process.env.HOME ? path.join(process.env.HOME, '.cache', 'node', 'corepack') : undefined)
    if (corepack) env.COREPACK_HOME = corepack
  }

  if (opts.passthrough) {
    // Copy exactly the named host vars that are set; unset names stay absent.
    for (const name of opts.passthrough) {
      const value = process.env[name]
      if (value !== undefined) env[name] = value
    }
    // Colour off for clean captured build/probe logs (overrides any host value).
    env.NO_COLOR = '1'
    env.FORCE_COLOR = '0'
  }

  // Declared additions, recipe then scenario (scenario wins).
  if (opts.recipeEnv) Object.assign(env, opts.recipeEnv)
  if (opts.scenarioEnv) Object.assign(env, opts.scenarioEnv)

  return env
}

/**
 * Overlay ONE cli step's declared `env` onto the scenario's sandbox env — the last
 * and only per-child layer. Returns a fresh object (the sandbox env itself is never
 * mutated), so the overlay dies with the step and the next step runs against the
 * scenario env unchanged. Hermeticity is inherited: `base` is already allowlist-built,
 * so a step can only ADD declared names, never re-admit a host var.
 */
export function overlayStepEnv(
  base: NodeJS.ProcessEnv,
  stepEnv?: Record<string, string>,
): NodeJS.ProcessEnv {
  if (!stepEnv) return base
  return { ...base, ...stepEnv }
}
