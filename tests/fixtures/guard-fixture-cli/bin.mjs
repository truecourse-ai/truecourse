#!/usr/bin/env node
/**
 * relkit — a tiny release-helper CLI used as a realistic target for guard-runner
 * engine tests. It has a config file, a report command that emits a timestamp /
 * version / duration / absolute path (one line touching all four normalizers), a
 * stdin filter, an append-on-each-run command (for `repeat`), write/read commands
 * over an argv-named path, an outbound `fetch` against a base URL read from the
 * environment (the `setup.http` stub target), a background release watcher, an
 * interactive publish that only asks on a terminal, a channel menu that reads
 * KEYS rather than lines, a cwd reporter, a both-streams warning, and failure /
 * hang commands (for the error paths).
 */

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { execFileSync, spawn } from 'node:child_process'

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

  case 'publish': {
    // The interactive path a release CLI ships: a destructive action asks for a
    // confirmation, and only asks when there is a terminal to ask on. With piped
    // stdin there is no way to answer, so it refuses instead of guessing — which
    // is exactly why a scenario needs a real pty to reach the question at all.
    if (!process.stdin.isTTY) {
      process.stderr.write('error: publish needs a terminal to confirm on (use --yes in scripts)\n')
      process.exit(2)
    }
    process.stdout.write(`Publish relkit v${VERSION}? [y/N] `)
    const answer = await new Promise((resolve) => {
      process.stdin.setEncoding('utf-8')
      process.stdin.once('data', (chunk) => {
        // Let go of the terminal, or the flowing stdin keeps the process alive
        // after the answer — the pause every interactive CLI does here.
        process.stdin.pause()
        resolve(String(chunk).trim().toLowerCase())
      })
    })
    if (answer !== 'y' && answer !== 'yes') {
      process.stdout.write('\nPublish cancelled\n')
      process.exit(1)
    }
    fs.writeFileSync(path.resolve(cwd, 'published.txt'), `${VERSION}\n`)
    process.stdout.write(`\nPublished relkit v${VERSION}\n`)
    break
  }

  case 'channel': {
    // The other interactive shape a release CLI ships: a menu. Unlike `publish` it
    // reads KEYS, so it puts the terminal in raw mode, and — like every select
    // prompt (clack, inquirer, prompts) — it submits on RETURN, the key Enter
    // sends on a terminal (`\r`). A newline is the different `enter` key and picks
    // nothing, so an answer that arrives as a LINE never chooses a channel.
    if (!process.stdin.isTTY) {
      process.stderr.write('error: channel needs a terminal to pick on (use --set <name> in scripts)\n')
      process.exit(2)
    }
    const options = ['stable', 'beta', 'canary']
    let cursor = 0
    if (args.includes('--check')) {
      // Print, then go away and work, and only THEN take over the terminal — the
      // shape that makes an answer typed at the first pause useless.
      process.stdout.write('Checking the registry for published channels...\n')
      await new Promise((r) => setTimeout(r, Number(process.env.RELKIT_CHANNEL_CHECK_MS ?? 400)))
    }
    readline.emitKeypressEvents(process.stdin)
    process.stdin.setRawMode(true)
    const render = () => {
      const menu = options.map((o, i) => `${i === cursor ? '>' : ' '} ${o}\n`).join('')
      process.stdout.write(`Release channel for relkit v${VERSION}:\n${menu}`)
    }
    render()
    const picked = await new Promise((resolve) => {
      const onKeypress = (_char, key) => {
        if (!key) return
        if (key.ctrl && key.name === 'c') process.exit(130)
        else if (key.name === 'down') {
          cursor = (cursor + 1) % options.length
          render()
        } else if (key.name === 'up') {
          cursor = (cursor - 1 + options.length) % options.length
          render()
        } else if (key.name === 'return') {
          process.stdin.off('keypress', onKeypress)
          resolve(options[cursor])
        }
      }
      process.stdin.on('keypress', onKeypress)
    })
    process.stdin.setRawMode(false)
    process.stdin.pause()
    fs.writeFileSync(path.resolve(cwd, 'channel.txt'), `${picked}\n`)
    process.stdout.write(`Release channel set to ${picked}\n`)
    break
  }

  case 'where':
    // Report the directory the process was started in — how a scenario proves a
    // per-step `cwd` reached the child rather than the sandbox root.
    process.stdout.write(`cwd=${cwd}\n`)
    break

  case 'warn':
    // One message on EACH stream: the shape an assertion that cannot pin a stream
    // (`expect.output`) is written against.
    process.stdout.write('scanned 3 files\n')
    process.stderr.write('warning: skipped bulk.js (over the per-file budget)\n')
    break

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

  case 'watch': {
    // Start the background release watcher and return immediately. The watcher
    // inherits this process's stdout/stderr, so it keeps the pipes open after
    // relkit itself is gone — the naive daemonization real CLIs ship.
    const ms = Number(process.env.RELKIT_WATCH_MS ?? 60_000)
    const watcher = spawn(process.execPath, ['-e', `setTimeout(() => {}, ${ms})`], { stdio: 'inherit' })
    watcher.unref()
    process.stdout.write(`watching in the background (pid ${watcher.pid})\n`)
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
