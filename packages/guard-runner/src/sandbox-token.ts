/**
 * The `${sandbox}` token — the absolute path of THIS scenario's working directory,
 * the one runner-owned value a scenario legitimately needs to spell out.
 *
 * A hermetic scenario has to point the program under test at state inside its own
 * sandbox: a home directory the run may create and mutate (`TOOL_HOME:
 * ${sandbox}/home`), an absolute path in a config file a tool resolves relative to
 * nothing (`git config core.excludesFile ${sandbox}/.globalexcludes`). That path
 * only exists once the sandbox is made, so it cannot be written literally — left
 * un-interpolated it lands on disk verbatim and every reference to it misses, or
 * worse, resolves against the developer's real machine.
 *
 * It is the SANDBOX CWD, deliberately: `${sandbox}/x` and the relative path `x`
 * then name the same file, so a scenario can seed a file with `write:` and hand
 * its absolute form to a tool in the next step without a second rule to learn.
 *
 * Same surgical-replacement rule as `${unique}` (see `unique.ts`): a literal
 * substring swap, never a parser, applied to scenario-AUTHORED strings only. The
 * recipe-owned entrypoint is never interpolated.
 */

import type { GuardComparison, GuardExpect, GuardFileExpect, GuardSetup } from '@truecourse/shared'

/** The literal token scenarios write. */
export const SANDBOX_TOKEN = '${sandbox}'

/** Replace every literal `${sandbox}` occurrence with the sandbox cwd path. */
export function applySandbox(text: string, cwd: string): string {
  return text.split(SANDBOX_TOKEN).join(cwd)
}

/** Interpolate every VALUE of a scenario-authored string map (an env overlay). */
export function applySandboxEnv(
  env: Record<string, string>,
  cwd: string,
): Record<string, string> {
  return Object.fromEntries(Object.entries(env).map(([k, v]) => [k, applySandbox(v, cwd)]))
}

/**
 * Interpolate `${sandbox}` across a scenario's SETUP — the seeded files (paths and
 * content), the env, and the git capability's path lists, which name `setup.files`
 * entries and so must resolve identically. Idempotent, so applying it to an
 * already-resolved setup is a no-op.
 */
export function applySandboxSetup(
  setup: GuardSetup | undefined,
  cwd: string,
): GuardSetup | undefined {
  if (!setup) return setup
  const s = (text: string): string => applySandbox(text, cwd)
  return {
    ...setup,
    ...(setup.files
      ? { files: Object.fromEntries(Object.entries(setup.files).map(([k, v]) => [s(k), s(v)])) }
      : {}),
    ...(setup.env ? { env: applySandboxEnv(setup.env, cwd) } : {}),
    ...(setup.git
      ? {
          git: {
            ...setup.git,
            ...(setup.git.root ? { root: s(setup.git.root) } : {}),
            ...(setup.git.commits
              ? { commits: setup.git.commits.map((c) => ({ ...c, files: c.files.map(s) })) }
              : {}),
            ...(setup.git.staged ? { staged: setup.git.staged.map(s) } : {}),
          },
        }
      : {}),
  }
}

/**
 * Interpolate `${sandbox}` in a cli EXPECTATION — its matcher values AND its
 * `files` KEYS (the asserted paths), exactly as `applyUniqueExpect` does for
 * `${unique}`: a step that was given the resolved path must be asserted on the
 * resolved path, or every such assertion reports as missing.
 */
export function applySandboxExpect<E extends GuardExpect | GuardFileExpect>(
  expect: E,
  cwd: string,
): E {
  return mapExpectStrings(expect, (text) => applySandbox(text, cwd))
}

/**
 * A comparison's STRING operands rewritten with `s` — this is where
 * `atMost: "${captured:estimate}"` becomes `atMost: "0.42"`, so the comparison
 * compares numbers and every failure message quotes the resolved value. A literal
 * numeric operand carries no token and is left as the number it is.
 */
export function mapComparisonStrings(
  compare: GuardComparison,
  s: (text: string) => string,
): GuardComparison {
  const operand = (v: string | number | undefined): string | number | undefined =>
    typeof v === 'string' ? s(v) : v
  return {
    ...compare,
    ...(compare.equals !== undefined ? { equals: operand(compare.equals) } : {}),
    ...(compare.atMost !== undefined ? { atMost: operand(compare.atMost) } : {}),
    ...(compare.atLeast !== undefined ? { atLeast: operand(compare.atLeast) } : {}),
  }
}

/**
 * Rewrite every AUTHORED string of an expectation with `s` — the matcher values of
 * each stream plus the `files` keys. The one traversal every token pass shares, so
 * a new token can never reach three quarters of an expectation because its own copy
 * of this walk missed a field.
 */
export function mapExpectStrings<E extends GuardExpect | GuardFileExpect>(
  expect: E,
  s: (text: string) => string,
): E {
  const stream = <M extends { equals?: string; contains?: string; matches?: string; compare?: GuardComparison }>(
    m: M,
  ): M => ({
    ...m,
    ...(m.equals !== undefined ? { equals: s(m.equals) } : {}),
    ...(m.contains !== undefined ? { contains: s(m.contains) } : {}),
    ...(m.matches !== undefined ? { matches: s(m.matches) } : {}),
    ...(m.compare !== undefined ? { compare: mapComparisonStrings(m.compare, s) } : {}),
  })
  const full = expect as GuardExpect
  return {
    ...expect,
    ...(full.stdout ? { stdout: stream(full.stdout) } : {}),
    ...(full.stderr ? { stderr: stream(full.stderr) } : {}),
    ...(full.output ? { output: stream(full.output) } : {}),
    ...(expect.files
      ? { files: Object.fromEntries(Object.entries(expect.files).map(([k, v]) => [s(k), stream(v)])) }
      : {}),
  }
}
