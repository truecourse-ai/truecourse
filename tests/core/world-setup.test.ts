/**
 * World setup over a tree that already has world scripts: scripts that hold
 * are kept without a session, and scripts that stopped holding are handed to
 * the world session with the stage that failed and what it printed. Real
 * scripts, run for real; the session is a scripted driver.
 */
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DriverResult, SessionDriver, SessionEvent, SessionPersistence, SessionRunInput } from '@truecourse/agent-loop'
import { worldDir, worldScriptPath } from '@truecourse/shared/work-tree'
import { runWorldSetup } from '../../packages/core/dist/services/product-world/world-setup.js'

const SERVER = `
const http = require('node:http')
http.createServer((req, res) => res.end('ok')).listen(Number(process.argv[2]), '127.0.0.1')
`
const BUILD = `echo build >> events.log\n`
const UP = `
set -e
PORT=$(echo "$TC_PORTS" | cut -d' ' -f1)
nohup node server.js "$PORT" > "$TC_WORLD_LOGS/server.log" 2>&1 &
echo $! > .truecourse/world/server.pid
echo "{ \\"baseUrl\\": \\"http://127.0.0.1:$PORT\\" }" > "$TC_WORLD_FILE"
`
const DOWN = `
if [ -f .truecourse/world/server.pid ]; then kill "$(cat .truecourse/world/server.pid)" 2>/dev/null || true; fi
`

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tree(scripts: { build?: string; up?: string }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-world-setup-'))
  roots.push(root)
  fs.writeFileSync(path.join(root, 'server.js'), SERVER)
  fs.mkdirSync(worldDir(root), { recursive: true })
  fs.writeFileSync(worldScriptPath(root, 'build'), scripts.build ?? BUILD)
  fs.writeFileSync(worldScriptPath(root, 'up'), scripts.up ?? UP)
  fs.writeFileSync(worldScriptPath(root, 'down'), DOWN)
  return root
}

/** A world session that does what `script` does with its tools, and records its briefing. */
function scripted(script: (input: SessionRunInput) => Promise<DriverResult>) {
  const briefings: string[] = []
  const driver: SessionDriver = {
    capabilities: { steering: 'turn-boundary', structuredOutcome: 'tool', resumeAtMessage: false },
    attribution: { provider: 'test', model: 'scripted' },
    runSession(input) {
      const done = (async (): Promise<DriverResult> => {
        await new Promise((resolve) => setTimeout(resolve, 0))
        for (const message of input.initialMessages) input.onEvent({ type: 'user-message', content: message })
        briefings.push(input.initialMessages.join('\n'))
        return script(input)
      })()
      return { done, status: () => 'running' as const, steer: () => {}, interrupt: async () => {} }
    },
  }
  const stored = new Map<string, SessionEvent[]>()
  const persistence: SessionPersistence = {
    appendEvent: (sessionId, event) => void stored.set(sessionId, [...(stored.get(sessionId) ?? []), event]),
    updateIndex: () => {},
    readEvents: (sessionId) => stored.get(sessionId) ?? [],
  }
  return { briefings, acquire: async () => ({ driver, persistence }) }
}

describe('world setup, on a tree that has world scripts', () => {
  it('keeps scripts that hold, with no session', async () => {
    const root = tree({})
    const model = scripted(async () => {
      throw new Error('no session should open')
    })

    const result = await runWorldSetup({ repoRoot: root, worldId: 'tc-world-setup', acquire: model.acquire })

    expect(result).toMatchObject({ status: 'ok', outcome: 'kept' })
    expect(model.briefings).toEqual([])
  }, 60_000)

  it('hands scripts that stopped holding to the session, with the stage that failed and what it printed', async () => {
    const root = tree({ build: `echo build >> events.log\necho "error: lockfile is out of date" >&2\nexit 1\n` })
    const model = scripted(async (input) => {
      // The repair the failure calls for, held to the engine's own build and boot.
      fs.writeFileSync(worldScriptPath(root, 'build'), BUILD)
      const verified = await input.def.tools.find((t) => t.name === 'verify_world')!.execute({}, {} as never)
      expect(verified.content).toContain('PASSED')
      input.onEvent({ type: 'tool-result', toolName: 'verify_world', content: verified.content })
      return { kind: 'outcome', value: { summary: 'One node server.', notRunning: [] } }
    })

    const result = await runWorldSetup({ repoRoot: root, worldId: 'tc-world-setup', acquire: model.acquire })

    expect(result).toMatchObject({ status: 'ok', outcome: 'written' })
    expect(model.briefings).toHaveLength(1)
    const [briefing] = model.briefings
    expect(briefing).toContain('The scripts already exist under .truecourse/world/. They brought this product up at an earlier commit.')
    expect(briefing).toContain('they failed at build (`.truecourse/world/build.sh`):')
    expect(briefing).toContain('| world/build.sh exited 1:')
    expect(briefing).toContain('| error: lockfile is out of date')
    expect(briefing).toContain('Start from those scripts.')
  }, 60_000)

  it('says nothing of a failure when the scripts are being written afresh', async () => {
    const root = tree({ build: `exit 1\n` })
    const model = scripted(async () => ({ kind: 'failure', failure: { kind: 'budget-exhausted', retryability: 'none' } }))

    const result = await runWorldSetup({ repoRoot: root, worldId: 'tc-world-setup', acquire: model.acquire, refresh: true })

    expect(result.status).toBe('failed')
    expect(model.briefings[0]).not.toContain('The scripts already exist')
  }, 60_000)
})
