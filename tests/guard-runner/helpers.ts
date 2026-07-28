import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { GuardApiScenario, GuardCliScenario, GuardScenario } from '@truecourse/shared'
import { buildDocSectionIndex } from '@truecourse/guard-runner'

/** Absolute path to the realistic fixture CLI (`relkit`). */
export const FIXTURE_BIN = fileURLToPath(
  new URL('../fixtures/guard-fixture-cli/bin.mjs', import.meta.url),
)

/**
 * A shared spec doc the engine tests bind to so their scenarios resolve as
 * `match` (a run only executes scenarios whose bound section is present and
 * unchanged). It carries one heading path per anchor the tests use; `writeRecipe`
 * seeds it, and {@link specBinds} returns the live binding for a given anchor.
 */
export const SPEC_DOC_PATH = 'docs/spec.md'

const SPEC_ANCHORS = [
  'a/b',
  'spec/section',
  'cli/version',
  'cli/whoami',
  'cli/boom',
  'same/section',
] as const

/** Emit a markdown doc whose section index yields exactly `anchors`. */
function buildSpecDoc(anchors: readonly string[]): string {
  const lines: string[] = []
  const emitted = new Set<string>()
  for (const anchor of anchors) {
    const segs = anchor.split('/')
    let prefix = ''
    for (let i = 0; i < segs.length; i++) {
      prefix = prefix ? `${prefix}/${segs[i]}` : segs[i]
      if (emitted.has(prefix)) continue
      emitted.add(prefix)
      lines.push(`${'#'.repeat(i + 1)} ${segs[i]}`, `body ${prefix}`, '')
    }
  }
  return lines.join('\n')
}

const SPEC_DOC = buildSpecDoc(SPEC_ANCHORS)
const SPEC_INDEX = buildDocSectionIndex(SPEC_DOC_PATH, SPEC_DOC)

/** The live binding list (doc + anchor + fingerprint) for sections of the shared doc. */
export function specBinds(...sections: string[]): GuardScenario['binds'] {
  return sections.map((section) => {
    const s = SPEC_INDEX.byAnchor.get(section)
    if (!s) throw new Error(`shared spec doc has no section "${section}"`)
    return { doc: SPEC_DOC_PATH, section, fingerprint: s.fingerprint }
  }) as GuardScenario['binds']
}

/** Seed the shared spec doc into a repo (idempotent). */
export function writeSpecDoc(repo: string): void {
  const target = path.join(repo, SPEC_DOC_PATH)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, SPEC_DOC)
}

/** A throwaway repo root with a `package.json` (so the recipe fingerprint has input). */
export function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-test-'))
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'tmp-fixture-repo', version: '0.0.0' }),
  )
  return dir
}

export function rmrf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

/** Write a recipe.json whose entry invokes the fixture CLI, plus the shared spec doc. */
export function writeRecipe(
  repo: string,
  overrides: { install?: string; build?: string; entry?: string[]; env?: Record<string, string> } = {},
): void {
  const recipe = {
    ...(overrides.install ? { install: overrides.install } : {}),
    build: overrides.build ?? 'true',
    entry: overrides.entry ?? ['node', FIXTURE_BIN],
    ...(overrides.env ? { env: overrides.env } : {}),
  }
  const target = path.join(repo, '.truecourse', 'scenarios', 'recipe.json')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(recipe, null, 2))
  writeSpecDoc(repo)
}

/** Write a scenario file (YAML is a superset of JSON, so JSON content parses fine). */
export function writeScenarioFile(repo: string, relPath: string, content: string): void {
  const target = path.join(repo, '.truecourse', 'scenarios', relPath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

/** Build a full, valid cli scenario from a partial spec. */
export function scenario(
  partial: Partial<GuardCliScenario> & Pick<GuardCliScenario, 'id' | 'steps'>,
): GuardCliScenario {
  return {
    guard: 2,
    id: partial.id,
    title: partial.title ?? partial.id,
    ...(partial.flow ? { flow: partial.flow } : {}),
    ...(partial.journey ? { journey: partial.journey } : {}),
    binds: partial.binds ?? specBinds('a/b'),
    driver: 'cli',
    ...(partial.setup ? { setup: partial.setup } : {}),
    steps: partial.steps,
    normalize: partial.normalize ?? [],
  }
}

/** Write a scenario object into the repo as a `.yaml` file. */
export function writeScenario(repo: string, relPath: string, s: GuardScenario): void {
  writeScenarioFile(repo, relPath, JSON.stringify(s, null, 2))
}

/**
 * Host vars that must NEVER reach a guard child — secrets, platform config, and
 * launch artifacts. Planted in process.env and asserted absent by the env tests.
 */
export const PLANTED_SECRETS: Record<string, string> = {
  DATABASE_URL: 'postgres://user:pw@host/db',
  TRUECOURSE_SECRET_KEY: 'master-secret-32-characters-longxx',
  GITHUB_APP_PRIVATE_KEY: '-----BEGIN KEY-----',
  ANTHROPIC_API_KEY: 'sk-ant-secret',
  AWS_SECRET_ACCESS_KEY: 'aws-secret',
  NODE_ENV: 'production',
  npm_config_registry: 'https://registry.example.com',
  CI: 'true',
}

/** Run `fn` with the planted vars set in process.env, restoring the prior state. */
export async function withPlantedSecrets(fn: () => void | Promise<void>): Promise<void> {
  const saved: Record<string, string | undefined> = {}
  for (const key of Object.keys(PLANTED_SECRETS)) saved[key] = process.env[key]
  Object.assign(process.env, PLANTED_SECRETS)
  try {
    await fn()
  } finally {
    for (const [key, prev] of Object.entries(saved)) {
      if (prev === undefined) delete process.env[key]
      else process.env[key] = prev
    }
  }
}

// --- Api-driver fixtures ----------------------------------------------------

/** Absolute path to the fixture HTTP API (`todos`). */
export const FIXTURE_API_SERVER = fileURLToPath(
  new URL('../fixtures/guard-fixture-api/server.mjs', import.meta.url),
)

/** Absolute path to the fixture server that dies at startup. */
export const FIXTURE_API_CRASH = fileURLToPath(
  new URL('../fixtures/guard-fixture-api/crash.mjs', import.meta.url),
)

/** Absolute path to the fixture seed command (`node seed.mjs`, env-driven manifest). */
export const FIXTURE_API_SEED = fileURLToPath(
  new URL('../fixtures/guard-fixture-api/seed.mjs', import.meta.url),
)

/** A recipe `api.seed` block whose command runs the fixture seed script. */
export interface SeedOverride {
  provides: {
    credentials?: Record<string, { header: string; description?: string }>
    fixtures?: Record<string, string[]>
  }
}

/** Write a recipe.json whose `api` block boots the fixture todos server. */
export function writeApiRecipe(
  repo: string,
  overrides: {
    build?: string
    entry?: string[]
    serve?: string[]
    healthPath?: string
    readyTimeoutMs?: number
    env?: Record<string, string>
    apiEnv?: Record<string, string>
    services?: { up: string; down?: string }
    credentials?: Record<
      string,
      {
        header: string
        value?: string
        valueFromEnv?: string
        description?: string
        fromRequest?: {
          method: string
          path: string
          headers?: Record<string, string>
          body?: string
          json?: unknown
          capture?: string
          captureHeader?: string
          template?: string
        }
      }
    >
    seed?: SeedOverride
    /** `api.externals` — user-provided external API accounts (item 62). */
    externals?: Record<string, unknown>
  } = {},
): void {
  const recipe = {
    build: overrides.build ?? 'true',
    ...(overrides.entry ? { entry: overrides.entry } : {}),
    ...(overrides.env ? { env: overrides.env } : {}),
    api: {
      serve: overrides.serve ?? ['node', FIXTURE_API_SERVER],
      healthPath: overrides.healthPath ?? '/health',
      ...(overrides.readyTimeoutMs ? { readyTimeoutMs: overrides.readyTimeoutMs } : {}),
      ...(overrides.apiEnv ? { env: overrides.apiEnv } : {}),
      ...(overrides.services ? { services: overrides.services } : {}),
      ...(overrides.credentials ? { credentials: overrides.credentials } : {}),
      ...(overrides.seed ? { seed: { command: `node ${FIXTURE_API_SEED}`, provides: overrides.seed.provides } } : {}),
      ...(overrides.externals ? { externals: overrides.externals } : {}),
    },
  }
  const target = path.join(repo, '.truecourse', 'scenarios', 'recipe.json')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(recipe, null, 2))
  writeSpecDoc(repo)
}

/** Build a full, valid api scenario from a partial spec. */
export function apiScenario(
  partial: Partial<GuardApiScenario> & Pick<GuardApiScenario, 'id' | 'steps'>,
): GuardApiScenario {
  return {
    guard: 2,
    id: partial.id,
    title: partial.title ?? partial.id,
    ...(partial.flow ? { flow: partial.flow } : {}),
    ...(partial.journey ? { journey: partial.journey } : {}),
    binds: partial.binds ?? specBinds('a/b'),
    driver: 'api',
    ...(partial.setup ? { setup: partial.setup } : {}),
    steps: partial.steps,
    normalize: partial.normalize ?? [],
  }
}
