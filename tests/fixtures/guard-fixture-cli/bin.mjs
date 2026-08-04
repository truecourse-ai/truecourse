#!/usr/bin/env node
/**
 * relkit — a tiny release-helper CLI used as a realistic target for guard-runner
 * engine tests. It has a config file, a report command that emits a timestamp /
 * version / duration / absolute path (one line touching all four normalizers), a
 * stdin filter, an append-on-each-run command (for `repeat`), write/read commands
 * over an argv-named path, an outbound `fetch` against a base URL read from the
 * environment (the `setup.http` stub target), and failure / hang commands (for the
 * error paths).
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const VERSION = '2.4.1'

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf-8')
}

const [command, ...args] = process.argv.slice(2)
const cwd = process.cwd()

switch (command) {
  case '--version':
  case 'version':
    process.stdout.write(`${VERSION}\n`)
    break

  case 'whoami':
    // Surfaces the sandboxed identity so isolation can be asserted.
    process.stdout.write(
      `home=${process.env.HOME}\nconfig=${process.env.XDG_CONFIG_HOME}\ntz=${process.env.TZ}\ncolor=${process.env.NO_COLOR ?? 'unset'}\n`,
    )
    break

  case 'report': {
    const start = Date.now()
    const outPath = path.resolve(cwd, 'dist', 'bundle.js')
    const elapsed = Date.now() - start
    process.stdout.write(
      `Built relkit v${VERSION} at ${new Date().toISOString()} in ${elapsed}ms -> ${outPath}\n`,
    )
    break
  }

  case 'init':
    fs.writeFileSync(
      path.resolve(cwd, '.relkitrc.json'),
      `${JSON.stringify({ name: 'demo', strict: false }, null, 2)}\n`,
    )
    process.stdout.write('Initialized .relkitrc.json\n')
    break

  case 'check': {
    const cfgPath = path.resolve(cwd, '.relkitrc.json')
    if (!fs.existsSync(cfgPath)) {
      process.stderr.write('error: .relkitrc.json not found — run `relkit init`\n')
      process.exit(2)
    }
    let cfg
    try {
      cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
    } catch {
      process.stderr.write('error: .relkitrc.json is not valid JSON\n')
      process.exit(2)
    }
    if (cfg.strict && !cfg.name) {
      process.stderr.write('error: strict mode requires a name\n')
      process.exit(3)
    }
    fs.writeFileSync(
      path.resolve(cwd, 'check-report.txt'),
      `name=${cfg.name ?? '(none)'}\nstrict=${cfg.strict ? 'yes' : 'no'}\n`,
    )
    process.stdout.write(`ok: ${cfg.name ?? '(unnamed)'}\n`)
    break
  }

  case 'note': {
    // Write `content` to the argv-named `path` — the shape a scenario uses to create
    // a resource it then asserts on by path (`expect.files`).
    const [notePath, content = ''] = args
    fs.writeFileSync(path.resolve(cwd, notePath), content)
    process.stdout.write(`Noted ${Buffer.byteLength(content)} bytes to ${notePath}\n`)
    break
  }

  case 'show': {
    // Print the argv-named file — reads back a path `setup.files` seeded.
    const [showPath] = args
    const target = path.resolve(cwd, showPath)
    if (!fs.existsSync(target)) {
      process.stderr.write(`error: ${showPath} not found\n`)
      process.exit(2)
    }
    process.stdout.write(fs.readFileSync(target, 'utf-8'))
    break
  }

  case 'tick': {
    // Appends one line per invocation — used to prove `repeat` runs N times.
    const log = path.resolve(cwd, 'ticks.log')
    const prior = fs.existsSync(log) ? fs.readFileSync(log, 'utf-8') : ''
    const count = prior.split('\n').filter(Boolean).length + 1
    fs.appendFileSync(log, `tick ${count}\n`)
    process.stdout.write(`tick ${count}\n`)
    break
  }

  case 'env': {
    // Echo the named env vars so tests can assert the sandbox allowlist: a host
    // secret reads `(unset)`, declared recipe/scenario vars read their value.
    for (const name of args) {
      process.stdout.write(`${name}=${process.env[name] ?? '(unset)'}\n`)
    }
    break
  }

  case 'fetch': {
    // Call the "third party" whose base URL comes from the environment — the shape a
    // `setup.http` stub fakes. `fetch <path> [method] [body]`; prints the status and
    // the body it got back, so a scenario can assert on the scripted response.
    const base = process.env.RELKIT_API_BASE
    if (!base) {
      process.stderr.write('RELKIT_API_BASE is not set\n')
      process.exit(2)
    }
    const [target = '/', method = 'GET', body] = args
    try {
      const res = await globalThis.fetch(`${base}${target}`, {
        method: method.toUpperCase(),
        headers: { 'content-type': 'application/json', 'x-relkit': VERSION },
        ...(body === undefined ? {} : { body }),
      })
      process.stdout.write(`status=${res.status}\nbody=${await res.text()}\n`)
    } catch (err) {
      process.stderr.write(`upstream call failed: ${err.message}\n`)
      process.exit(3)
    }
    break
  }

  case 'gitstate': {
    // Report the git world-state a setup capability materialized: whether cwd is
    // a repo and how many paths are staged (index changes) but not yet committed.
    const isRepo = fs.existsSync(path.resolve(cwd, '.git'))
    let staged = 0
    if (isRepo) {
      const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf-8' })
      staged = porcelain.split('\n').filter((l) => /^[AMDRC]/.test(l)).length
    }
    process.stdout.write(`repo=${isRepo ? 'yes' : 'no'}\nstaged=${staged}\n`)
    break
  }

  case 'shout': {
    const input = await readStdin()
    process.stdout.write(input.toUpperCase())
    break
  }

  case 'run-child': {
    // Spawn a child binary resolved via PATH and echo its stdout — proves a
    // scenario's setup.env.PATH override reaches CHILD processes (stub injection)
    // even when the interpreter running THIS program is pinned to the host.
    const [bin, ...rest] = args
    process.stdout.write(execFileSync(bin, rest, { cwd, encoding: 'utf-8' }))
    break
  }

  case 'hold': {
    // Concurrency probe (mirror of the api fixture's /hold): register a live marker,
    // sample how many are live NOW, then release after TC_CLI_HOLD_MS — the test reads
    // the peak sample to prove cli scenarios still run at the FULL sandbox width.
    const dir = process.env.TC_CLI_HOLD_DIR
    if (dir) {
      const marker = path.resolve(dir, `${process.pid}-${Date.now()}-${Math.random()}`)
      fs.writeFileSync(marker, '')
      const live = fs.readdirSync(dir).length
      if (process.env.TC_CLI_HOLD_SAMPLES) fs.appendFileSync(process.env.TC_CLI_HOLD_SAMPLES, `${live}\n`)
      await new Promise((r) => setTimeout(r, Number(process.env.TC_CLI_HOLD_MS ?? 200)))
      fs.unlinkSync(marker)
      process.stdout.write(`held ${live}\n`)
    } else {
      process.stdout.write('held 0\n')
    }
    break
  }

  case 'hang':
    // Never exits — exercises the per-step timeout.
    setInterval(() => {}, 1000)
    break

  case 'boom':
    process.stderr.write('fatal: intentional failure\n')
    process.exit(7)
    break

  default:
    process.stderr.write(`unknown command: ${command ?? '(none)'}\n`)
    process.exit(64)
}
