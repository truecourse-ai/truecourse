/**
 * THE LIVE SCREENS OPENER — the setup step standing a real app up for the
 * authoring sessions: the recipe's web surface served from a sandbox, a real
 * seed run for the principal, a real browser signed in with it, and the whole
 * world torn down on close. Against `guard-fixture-web` and the fixture seed,
 * so it is hermetic and fails loud when Chromium is missing.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { RecipeSchema, type Recipe } from '@truecourse/guard-runner'
import { openSetupLiveScreens } from '../../packages/core/src/services/guard-setup/live-screens'
import { FIXTURE_API_SEED, isAlive, makeTempRepo, playwrightBrowserPids, rmrf } from '../guard-runner/helpers.js'

const FIXTURE_WEB_SERVER = fileURLToPath(new URL('../fixtures/guard-fixture-web/server.mjs', import.meta.url))

const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!()
})

function recipe(over: Partial<Recipe> = {}): Recipe {
  return RecipeSchema.parse({
    build: 'true',
    entry: ['node', '-e', ''],
    web: { serve: ['node', FIXTURE_WEB_SERVER], healthPath: '/health', readyTimeoutMs: 20_000 },
    ...over,
  })
}

describe('openSetupLiveScreens', () => {
  it('serves the app, seeds it, signs the browser in with the seeded cookie, and tears everything down', async () => {
    const repo = makeTempRepo()
    cleanup.push(() => rmrf(repo))
    const manifest = JSON.stringify({
      credentials: { webSession: { value: 'session=seeded' } },
      fixtures: { link: { id: 7, password: 'hunter2' } },
    })
    const phases: string[] = []
    const opened = await openSetupLiveScreens({
      repoRoot: repo,
      recipe: recipe({
        env: { SEED_MANIFEST: manifest },
        api: {
          serve: ['node', FIXTURE_WEB_SERVER],
          seed: {
            command: `node ${FIXTURE_API_SEED}`,
            provides: { credentials: { webSession: { header: 'Cookie' } }, fixtures: { link: ['id', 'password'] } },
          },
        },
      }),
      onPhase: (running) => phases.push(running),
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    cleanup.push(() => opened.close())
    expect(opened.live.observer.principal).toBe('webSession')
    // The secret-shaped fixture field never reaches a session.
    expect(opened.live.fixtures).toEqual({ link: { id: 7 } })
    expect(phases).toEqual([
      'building the app (`true`)',
      `running the seed (\`node ${FIXTURE_API_SEED}\`)`,
      `serving the web surface (\`node ${FIXTURE_WEB_SERVER}\`)`,
      'opening a browser on the served surface',
    ])

    const seen = await opened.live.observer.observe({ path: '/' })
    expect(seen.ok).toBe(true)
    if (seen.ok) expect(seen.observation.tree).toContain('heading "Guard Web Fixture"')

    const browsers = playwrightBrowserPids()
    expect(browsers.length).toBeGreaterThan(0)
    await opened.close()
    await opened.close()
    for (const pid of browsers) expect(isAlive(pid)).toBe(false)
    await expect(opened.live.observer.observe({ path: '/' })).resolves.toMatchObject({ ok: false })
  }, 90_000)

  it('skips a seeded principal no browser can carry, and observes as the others', async () => {
    const repo = makeTempRepo()
    cleanup.push(() => rmrf(repo))
    const manifest = JSON.stringify({ credentials: { webSession: { value: 'session=seeded' }, brokenWebSession: { value: 'no-pair' } } })
    const opened = await openSetupLiveScreens({
      repoRoot: repo,
      recipe: recipe({
        env: { SEED_MANIFEST: manifest },
        api: {
          serve: ['node', FIXTURE_WEB_SERVER],
          seed: {
            command: `node ${FIXTURE_API_SEED}`,
            provides: { credentials: { webSession: { header: 'Cookie' }, brokenWebSession: { header: 'Cookie' } } },
          },
        },
      }),
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    cleanup.push(() => opened.close())
    expect([...(opened.live.principals?.keys() ?? [])]).toEqual(['webSession', 'anonymous'])
    expect(opened.live.unobservable?.get('brokenWebSession')).toMatch(/no name=value pair/)
  }, 90_000)

  it('refuses a recipe with no web block without booting anything', async () => {
    const repo = makeTempRepo()
    cleanup.push(() => rmrf(repo))
    const opened = await openSetupLiveScreens({ repoRoot: repo, recipe: RecipeSchema.parse({ build: 'true', entry: ['node', '-e', ''] }) })
    expect(opened).toMatchObject({ ok: false, reason: expect.stringMatching(/no `web` block/) })
  })

  it('refuses a surface that will not boot, with its output, and leaves nothing running', async () => {
    const repo = makeTempRepo()
    cleanup.push(() => rmrf(repo))
    const opened = await openSetupLiveScreens({
      repoRoot: repo,
      recipe: recipe({ web: { serve: ['node', '-e', 'console.error("no port for you"); process.exit(3)'], healthPath: '/health', readyTimeoutMs: 5_000 } }),
    })
    expect(opened.ok).toBe(false)
    if (opened.ok) return
    expect(opened.reason).toMatch(/the web surface would not boot/)
    expect(opened.reason).toMatch(/no port for you/)
  }, 30_000)

  it('refuses a seed that fails, naming the failure', async () => {
    const repo = makeTempRepo()
    cleanup.push(() => rmrf(repo))
    const opened = await openSetupLiveScreens({
      repoRoot: repo,
      recipe: recipe({
        env: { SEED_FAIL: 'the database is empty' },
        api: { serve: ['node', FIXTURE_WEB_SERVER], seed: { command: `node ${FIXTURE_API_SEED}`, provides: {} } },
      }),
    })
    expect(opened).toMatchObject({ ok: false, reason: expect.stringMatching(/the database is empty/) })
  }, 30_000)
})
