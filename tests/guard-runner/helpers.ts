import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { GuardScenario } from '@truecourse/shared'
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

/** The live binding (doc + anchor + fingerprint) for a section of the shared doc. */
export function specBinds(section: string): GuardScenario['binds'] {
  const s = SPEC_INDEX.byAnchor.get(section)
  if (!s) throw new Error(`shared spec doc has no section "${section}"`)
  return { doc: SPEC_DOC_PATH, section, fingerprint: s.fingerprint }
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

/** Build a full, valid scenario from a partial spec. */
export function scenario(
  partial: Partial<GuardScenario> & Pick<GuardScenario, 'id' | 'steps'>,
): GuardScenario {
  return {
    guard: 1,
    id: partial.id,
    title: partial.title ?? partial.id,
    binds: partial.binds ?? specBinds('a/b'),
    driver: 'cli',
    ...(partial.setup ? { setup: partial.setup } : {}),
    ...(partial.inputs ? { inputs: partial.inputs } : {}),
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
