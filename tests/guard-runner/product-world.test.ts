/**
 * The product world: three scripts in the work tree bring a product up and
 * down, and the engine establishes that they did. The "product" here is a
 * one-file HTTP server the up script leaves running.
 */
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  bootProductWorld,
  buildProductWorld,
  releaseWorldSlot,
  reserveWorldSlot,
  type WorldSlot,
} from '@truecourse/guard-runner'
import { worldDir, worldScriptPath } from '@truecourse/shared/work-tree'

const SERVER = `
const http = require('node:http')
http.createServer((req, res) => res.end('up')).listen(Number(process.argv[2]), '127.0.0.1')
`

/** Starts the server on the world's first port, in the background, and reports it. */
const UP = `
set -e
PORT=$(echo "$TC_PORTS" | cut -d' ' -f1)
nohup node server.js "$PORT" > "$TC_WORLD_LOGS/server.log" 2>&1 &
echo $! > .truecourse/world/server.pid
cat > "$TC_WORLD_FILE" <<JSON
{ "baseUrl": "http://127.0.0.1:$PORT", "accounts": [{ "name": "admin", "email": "admin@example.com", "password": "pw-$TC_WORLD_ID" }] }
JSON
`

const DOWN = `
if [ -f .truecourse/world/server.pid ]; then kill "$(cat .truecourse/world/server.pid)" 2>/dev/null || true; fi
`

const slots: WorldSlot[] = []
const trees: string[] = []

async function tree(scripts: { build?: string; up?: string; down?: string }): Promise<{ root: string; slot: WorldSlot }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-world-'))
  trees.push(root)
  fs.mkdirSync(worldDir(root), { recursive: true })
  fs.writeFileSync(path.join(root, 'server.js'), SERVER)
  for (const script of ['build', 'up', 'down'] as const) {
    const body = scripts[script]
    if (body !== undefined) fs.writeFileSync(worldScriptPath(root, script), body)
  }
  const slot = await reserveWorldSlot('tc-world-test')
  slots.push(slot)
  return { root, slot }
}

async function answers(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2_000) })
    return true
  } catch {
    return false
  }
}

afterEach(() => {
  for (const slot of slots.splice(0)) releaseWorldSlot(slot)
  for (const root of trees.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('the product world', () => {
  it('brings a product up, reports what is running, and takes it down', async () => {
    const { root, slot } = await tree({ build: 'echo built', up: UP, down: DOWN })

    const build = await buildProductWorld(root, { slot })
    expect(build).toMatchObject({ ok: true, output: 'built' })

    const boot = await bootProductWorld(root, { slot })
    if (!boot.ok) throw new Error(boot.reason)
    const { world } = boot.running
    expect(world.baseUrl).toBe(`http://127.0.0.1:${slot.ports[0]}`)
    expect(world.accounts).toEqual([{ name: 'admin', email: 'admin@example.com', password: 'pw-tc-world-test' }])
    expect(await answers(world.baseUrl)).toBe(true)

    expect((await boot.running.down()).ok).toBe(true)
    expect(await answers(world.baseUrl)).toBe(false)
  })

  it('stops what up.sh left running even when down.sh does nothing', async () => {
    const { root, slot } = await tree({ build: 'true', up: UP, down: 'true' })
    const boot = await bootProductWorld(root, { slot })
    if (!boot.ok) throw new Error(boot.reason)
    await boot.running.down()
    expect(await answers(boot.running.world.baseUrl)).toBe(false)
  })

  it('says which script is missing before running anything', async () => {
    const { root, slot } = await tree({ up: UP })
    expect(await bootProductWorld(root, { slot })).toEqual({
      ok: false,
      stage: 'scripts',
      reason: 'no world/build.sh, world/down.sh in the work tree',
    })
  })

  it('reports a failing up.sh with what it printed', async () => {
    const { root, slot } = await tree({ build: 'true', up: 'echo "migration failed: relation users exists"; exit 3', down: 'true' })
    const boot = await bootProductWorld(root, { slot })
    expect(boot).toMatchObject({ ok: false, stage: 'up' })
    if (boot.ok) return
    expect(boot.reason).toContain('exited 3')
    expect(boot.reason).toContain('migration failed: relation users exists')
  })

  it('refuses an up.sh that exits zero without saying what is running', async () => {
    const { root, slot } = await tree({ build: 'true', up: 'true', down: 'true' })
    expect(await bootProductWorld(root, { slot })).toMatchObject({ ok: false, stage: 'report' })

    fs.writeFileSync(worldScriptPath(root, 'up'), 'echo \'{"accounts": []}\' > "$TC_WORLD_FILE"')
    const boot = await bootProductWorld(root, { slot })
    expect(boot).toMatchObject({ ok: false, stage: 'report' })
    if (!boot.ok) expect(boot.reason).toContain('baseUrl')
  })
})
