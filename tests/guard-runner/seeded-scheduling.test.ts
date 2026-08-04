import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runGuard } from '@truecourse/guard-runner'
import {
  apiScenario,
  makeTempRepo,
  rmrf,
  writeApiRecipe,
  writeScenario,
  writeScenarioFile,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

describe('runGuard — seeded scenario scheduling', () => {
  it('settles seedless work first, then runs seeded scenarios one at a time in deterministic order', async () => {
    const repo = makeTempRepo()
    repos.push(repo)
    const eventFile = path.join(repo, 'events.txt')
    const holdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-seed-schedule-'))
    writeApiRecipe(repo, {
      env: {
        TC_EVENT_FILE: eventFile,
        TC_HOLD_DIR: holdDir,
        TC_HOLD_MS: '300',
      },
    })

    for (const id of ['seedless-a', 'seedless-b']) {
      writeScenario(
        repo,
        `api/${id}.yaml`,
        apiScenario({
          id,
          steps: [{ request: { method: 'GET', path: '/hold' }, expect: { status: 200 } }],
        }),
      )
    }
    for (const id of ['seeded-a', 'seeded-b']) {
      writeScenario(
        repo,
        `api/${id}.yaml`,
        apiScenario({
          id,
          setup: { seed: { provides: { fixtures: { marker: ['id'] } } } },
          steps: [{ request: { method: 'GET', path: '/health' }, expect: { status: 200 } }],
        }),
      )
      writeScenarioFile(
        repo,
        `api/${id}.seed.mjs`,
        `import fs from 'node:fs'\n` +
          `fs.appendFileSync(process.env.TC_EVENT_FILE, ${JSON.stringify(`seed:${id}\n`)})\n` +
          `fs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify({fixtures:{marker:{id:${JSON.stringify(id)}}}}))\n`,
      )
    }

    const res = await runGuard({
      repoRoot: repo,
      skipBuild: true,
      concurrency: 4,
      onScenarioSettled: (_done, _total, result) => {
        fs.appendFileSync(eventFile, `settled:${result.id}\n`)
      },
    })

    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.summary).toMatchObject({ total: 4, pass: 4 })
    const events = fs.readFileSync(eventFile, 'utf-8').trim().split('\n')
    const firstSeed = events.findIndex((event) => event.startsWith('seed:'))
    expect(events.slice(0, firstSeed).sort()).toEqual(['settled:seedless-a', 'settled:seedless-b'])
    expect(events.slice(firstSeed)).toEqual([
      'seed:seeded-a',
      'settled:seeded-a',
      'seed:seeded-b',
      'settled:seeded-b',
    ])
    fs.rmSync(holdDir, { recursive: true, force: true })
  })
})
