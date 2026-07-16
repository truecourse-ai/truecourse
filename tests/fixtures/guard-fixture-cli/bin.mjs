#!/usr/bin/env node
/**
 * relkit — a tiny release-helper CLI used as a realistic target for guard-runner
 * engine tests. It has a config file, a report command that emits a timestamp /
 * version / duration / absolute path (one line touching all four normalizers), a
 * stdin filter, an append-on-each-run command (for `repeat`), and failure /
 * hang commands (for the error paths).
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

  case 'fmt': {
    // Read a JSON file (arg) or stdin, print it canonically (2-space indent) to
    // stdout. Deterministic and idempotent: canonical JSON is a fixed point, so
    // fmt(fmt(x)) === fmt(x). Invalid JSON exits 5 (used for the "re-parses clean"
    // step-chaining property).
    const source = args[0] ? fs.readFileSync(path.resolve(cwd, args[0]), 'utf-8') : await readStdin()
    let obj
    try {
      obj = JSON.parse(source)
    } catch {
      process.stderr.write('error: input is not valid JSON\n')
      process.exit(5)
    }
    process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`)
    break
  }

  case 'normalize': {
    // Rewrite a JSON file IN PLACE in canonical form. Idempotent: a second run over
    // already-canonical content produces byte-identical output (the invariant
    // "formatting is idempotent" / "fix never breaks your code" is checked over a
    // corpus with stableOnRerun).
    const file = path.resolve(cwd, args[0] ?? 'input')
    let obj
    try {
      obj = JSON.parse(fs.readFileSync(file, 'utf-8'))
    } catch {
      process.stderr.write('error: input is not valid JSON\n')
      process.exit(5)
    }
    fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`)
    process.stdout.write(`normalized ${args[0] ?? 'input'}\n`)
    break
  }

  case 'parse': {
    // Validate JSON from a file arg or stdin; exit 0 (valid) or 5 (invalid). The
    // parse side of the "fmt output re-parses clean" step-chain.
    const source = args[0] ? fs.readFileSync(path.resolve(cwd, args[0]), 'utf-8') : await readStdin()
    try {
      JSON.parse(source)
    } catch {
      process.stderr.write('error: not valid JSON\n')
      process.exit(5)
    }
    process.stdout.write('valid\n')
    break
  }

  case 'bump': {
    // A deliberately NON-idempotent in-place edit: append a line every run, so the
    // file differs after a second run (exercises the stableOnRerun file-idempotence
    // failure path — a "fix" that keeps changing already-fixed input).
    const file = path.resolve(cwd, args[0] ?? 'input')
    const prior = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : ''
    fs.writeFileSync(file, `${prior}bumped\n`)
    process.stdout.write('bumped\n')
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
