/**
 * The v3 cli step kinds, EXECUTED: `git` invocations (hermetic, never the
 * developer's identity), `write` / `delete` file mutation between runs, per-step
 * `cwd`, `tty` with scripted answers on a real pseudo-terminal, the combined
 * `output` matcher, and `${sandbox}` interpolation.
 *
 * These run through `runGuard` against the fixture CLI, so what is proved is what
 * a committed scenario actually does — not what the schema allows.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { runGuard, applySandbox, applySandboxSetup } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeRecipe, writeScenario, scenario } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

/** Run one committed scenario and return its result row. */
async function run(r: string, id: string) {
  const res = await runGuard({ repoRoot: r, skipBuild: true, scenarioId: id })
  if (res.status !== 'ok') throw new Error(`expected ok, got ${res.status}`)
  return res.latest.scenarios[0]
}

describe('git steps', () => {
  it('runs git in the sandbox and asserts on what it prints', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'git.yaml',
      scenario({
        id: 'gitstep',
        setup: {
          files: { 'README.md': '# readme\n' },
          git: { commits: [{ files: ['README.md'], message: 'seed the repo' }] },
        },
        steps: [
          { git: ['log', '--oneline'], expect: { exit: 0, stdout: { contains: 'seed the repo' } } },
          { git: ['check-ignore', 'README.md'], expect: { exit: 1 } },
          { git: ['status', '--porcelain'], expect: { exit: 0, stdout: { equals: '' } } },
        ],
      }),
    )
    expect((await run(r, 'gitstep')).outcome).toBe('pass')
  })

  it('commits under the DECLARED identity, never the developer’s', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'identity.yaml',
      scenario({
        id: 'identity',
        setup: {
          files: { 'a.txt': 'a\n' },
          git: { identity: { name: 'TrueCourse Reference', email: 'reference@truecourse.test' } },
        },
        steps: [
          { git: ['add', 'a.txt'], expect: { exit: 0 } },
          { git: ['commit', '-m', 'first'], expect: { exit: 0 } },
          {
            git: ['log', '--format=%an <%ae>', '-1'],
            expect: { exit: 0, stdout: { contains: 'TrueCourse Reference <reference@truecourse.test>' } },
          },
          // A step may override the scenario identity for one invocation.
          {
            git: ['commit', '--allow-empty', '-m', 'second'],
            identity: { name: 'Other Dev', email: 'other@truecourse.test' },
            expect: { exit: 0 },
          },
          {
            git: ['log', '--format=%cn <%ce>', '-1'],
            expect: { exit: 0, stdout: { contains: 'Other Dev <other@truecourse.test>' } },
          },
        ],
      }),
    )
    expect((await run(r, 'identity')).outcome).toBe('pass')
  })

  it('reads NO host git config — a global setting cannot decide a sandbox outcome', async () => {
    const r = repo()
    writeRecipe(r)
    // A global config the host might carry: `commit.gpgsign` would break every
    // commit, and a bogus `user.name` would be attributed to the sandbox commit.
    const fakeHome = fs.mkdtempSync(path.join(r, 'fakehome-'))
    fs.writeFileSync(
      path.join(fakeHome, '.gitconfig'),
      '[user]\n  name = Host Developer\n  email = host@example.com\n[commit]\n  gpgsign = true\n',
    )
    writeScenario(
      r,
      'hostconfig.yaml',
      scenario({
        id: 'hostconfig',
        setup: { files: { 'a.txt': 'a\n' }, git: {} },
        steps: [
          { git: ['add', 'a.txt'], expect: { exit: 0 } },
          { git: ['commit', '-m', 'x'], expect: { exit: 0 } },
          {
            git: ['log', '--format=%an', '-1'],
            expect: { exit: 0, stdout: { matches: '^(?![\\s\\S]*Host Developer)[\\s\\S]*$' } },
          },
        ],
      }),
    )
    const prevHome = process.env.HOME
    const prevGlobal = process.env.GIT_CONFIG_GLOBAL
    process.env.HOME = fakeHome
    delete process.env.GIT_CONFIG_GLOBAL
    try {
      expect((await run(r, 'hostconfig')).outcome).toBe('pass')
    } finally {
      if (prevHome === undefined) delete process.env.HOME
      else process.env.HOME = prevHome
      if (prevGlobal !== undefined) process.env.GIT_CONFIG_GLOBAL = prevGlobal
    }
  })

  it('records the git step in the evidence transcript as a git invocation', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'evidence.yaml',
      scenario({
        id: 'gitevidence',
        setup: { files: { 'a.txt': 'a\n' }, git: {} },
        steps: [{ git: ['status', '--porcelain'], expect: { exit: 0, stdout: { contains: '?? a.txt' } } }],
      }),
    )
    const result = await run(r, 'gitevidence')
    expect(result.outcome).toBe('pass')
    const invocation = JSON.parse(
      fs.readFileSync(path.join(r, result.evidencePath!, 'invocation.json'), 'utf-8'),
    )
    expect(invocation.steps[0]).toMatchObject({ kind: 'git', argv: ['git', 'status', '--porcelain'] })
  })
})

describe('write and delete steps', () => {
  it('creates and removes sandbox files BETWEEN runs — the two-state world', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'twostate.yaml',
      scenario({
        id: 'twostate',
        setup: { files: { 'notes.txt': 'first\n' } },
        steps: [
          { run: ['show', 'notes.txt'], expect: { exit: 0, stdout: { equals: 'first\n' } } },
          // The edit BETWEEN the two runs — what setup-time seeding cannot express.
          { write: { 'notes.txt': 'second\n', 'deep/new.txt': 'made\n' }, expect: { files: { 'deep/new.txt': { exists: true } } } },
          { run: ['show', 'notes.txt'], expect: { exit: 0, stdout: { equals: 'second\n' } } },
          { delete: ['notes.txt'], expect: { files: { 'notes.txt': { absent: true } } } },
          { run: ['show', 'notes.txt'], expect: { exit: 2, stderr: { contains: 'not found' } } },
        ],
      }),
    )
    expect((await run(r, 'twostate')).outcome).toBe('pass')
  })

  it('fails the step when its own file assertion does not hold', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'writefail.yaml',
      scenario({
        id: 'writefail',
        steps: [{ write: { 'a.txt': 'x' }, expect: { files: { 'b.txt': { exists: true } } } }],
      }),
    )
    const result = await run(r, 'writefail')
    expect(result.outcome).toBe('fail')
    expect(result.failure).toMatchObject({ step: 1, expected: 'b.txt to exist' })
  })

  it('errors — never silently succeeds — when a deleted path is not there', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'ghost.yaml',
      scenario({ id: 'ghost', steps: [{ delete: ['nope.txt'] }, { run: [], expect: { exit: 0 } }] }),
    )
    const result = await run(r, 'ghost')
    expect(result.outcome).toBe('error')
    expect(result.failure?.actual).toContain('nope.txt does not exist')
  })

  it('refuses a path that escapes the sandbox', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'escape.yaml',
      scenario({ id: 'escape', steps: [{ write: { '../outside.txt': 'x' } }] }),
    )
    const result = await run(r, 'escape')
    expect(result.outcome).toBe('error')
    expect(result.failure?.actual).toContain('escapes the sandbox')
  })
})

describe('per-step cwd', () => {
  it('runs the child in the declared directory, while assertions stay sandbox-relative', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cwd.yaml',
      scenario({
        id: 'cwdstep',
        setup: { files: { 'other-repo/.keep': '', 'other-repo/src.txt': 'x\n' } },
        steps: [
          // The program writes relative to ITS cwd; the file lands in the subdir.
          { run: ['note', 'made-here.txt', 'hello'], cwd: 'other-repo', expect: { exit: 0, files: { 'other-repo/made-here.txt': { contains: 'hello' } } } },
          // …and NOT in the sandbox root, which the same assertion set proves.
          { run: ['where'], cwd: 'other-repo', expect: { exit: 0, stdout: { matches: 'cwd=.*other-repo\\n' }, files: { 'made-here.txt': { absent: true } } } },
          { run: ['where'], expect: { exit: 0, stdout: { matches: '^(?![\\s\\S]*other-repo)[\\s\\S]*$' } } },
        ],
      }),
    )
    expect((await run(r, 'cwdstep')).outcome).toBe('pass')
  })

  it('drives a git repo that lives in a SUBDIRECTORY (setup.git.root)', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'gitroot.yaml',
      scenario({
        id: 'gitroot',
        setup: {
          files: { 'repo/README.md': '# readme\n' },
          git: { root: 'repo', commits: [{ files: ['README.md'], message: 'seed' }] },
        },
        steps: [
          // The repo is in `repo/`, so the sandbox root is NOT a git repo…
          { run: ['gitstate'], expect: { exit: 0, stdout: { contains: 'repo=no' } } },
          // …and its siblings (a clone) still live inside the sandbox.
          { git: ['clone', '.', '../clone-x'], cwd: 'repo', expect: { exit: 0, files: { 'clone-x/README.md': { exists: true } } } },
          { git: ['log', '--oneline'], cwd: 'clone-x', expect: { exit: 0, stdout: { contains: 'seed' } } },
        ],
      }),
    )
    expect((await run(r, 'gitroot')).outcome).toBe('pass')
  })

  it('refuses a step cwd that escapes the sandbox', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cwdescape.yaml',
      scenario({ id: 'cwdescape', steps: [{ run: ['where'], cwd: '../..', expect: { exit: 0 } }] }),
    )
    const result = await run(r, 'cwdescape')
    expect(result.outcome).toBe('error')
    expect(result.failure?.actual).toContain('escapes the sandbox')
    // An escape before anything ran has nothing to transcribe — no bundle.
    expect(result.evidencePath).toBeUndefined()
  })

  it('a mid-scenario escape still writes the transcript of the steps that DID run', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'late-escape.yaml',
      scenario({
        id: 'late-escape',
        steps: [
          { run: ['version'], expect: { exit: 0, stdout: { contains: '2.4.1' } } },
          { run: ['where'], cwd: '../..', expect: { exit: 0 } },
        ],
      }),
    )
    const result = await run(r, 'late-escape')
    expect(result.outcome).toBe('error')
    expect(result.failure?.step).toBe(2)
    expect(result.evidencePath).toBeDefined()
    const text = fs.readFileSync(path.join(r, result.evidencePath!, 'transcript.txt'), 'utf-8')
    expect(text).toContain('2.4.1')
  })
})

describe('tty steps', () => {
  it('reaches a prompt that only exists on a terminal, and answers it', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'tty.yaml',
      scenario({
        id: 'ttystep',
        steps: [
          // Piped stdin: the command refuses rather than guessing — the wall a
          // scenario without a pty hits.
          { run: ['publish'], stdin: 'y\n', expect: { exit: 2, stderr: { contains: 'needs a terminal' } } },
          // On a real pty the question is asked, and the scripted answer takes it.
          {
            run: ['publish'],
            tty: true,
            stdin: 'y\n',
            expect: { exit: 0, output: { contains: 'Publish relkit v2.4.1?' }, files: { 'published.txt': { contains: '2.4.1' } } },
          },
        ],
      }),
    )
    expect((await run(r, 'ttystep')).outcome).toBe('pass')
  })

  it('scripts the DECLINE path too, and the exit code comes back', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'ttyno.yaml',
      scenario({
        id: 'ttyno',
        steps: [
          {
            run: ['publish'],
            tty: true,
            stdin: 'n\n',
            expect: { exit: 1, output: { contains: 'Publish cancelled' }, files: { 'published.txt': { absent: true } } },
          },
        ],
      }),
    )
    expect((await run(r, 'ttyno')).outcome).toBe('pass')
  })

  it('answers a SELECT prompt, which submits only on a real carriage return', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'ttysel.yaml',
      scenario({
        id: 'ttysel',
        steps: [
          {
            run: ['channel'],
            tty: true,
            // Enter, as a terminal sends it. Written at spawn this would reach the
            // prompt as a newline (the line discipline's `ICRNL`) and pick nothing.
            stdin: '\r',
            expect: {
              exit: 0,
              output: { contains: 'Release channel for relkit' },
              files: { 'channel.txt': { contains: 'stable' } },
            },
          },
        ],
      }),
    )
    expect((await run(r, 'ttysel')).outcome).toBe('pass')
  })

  it('types the scripted answer as KEYS: an arrow moves the menu before Enter takes it', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'ttyarrow.yaml',
      scenario({
        id: 'ttyarrow',
        steps: [
          {
            run: ['channel'],
            tty: true,
            stdin: '\u001b[B\r',
            expect: { exit: 0, files: { 'channel.txt': { contains: 'beta' } } },
          },
        ],
      }),
    )
    expect((await run(r, 'ttyarrow')).outcome).toBe('pass')
  })

  it('answers a prompt the command only asks AFTER it has worked for a while', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'ttylate.yaml',
      scenario({
        id: 'ttylate',
        steps: [
          {
            // `--check` prints, then works, then takes over the terminal: the pause
            // looks like a prompt, and an answer typed into it is folded to a
            // newline by the still-canonical line discipline. The echo says so, and
            // the answer is typed again once the menu is really up.
            run: ['channel', '--check'],
            tty: true,
            stdin: '\r',
            expect: { exit: 0, files: { 'channel.txt': { contains: 'stable' } } },
          },
        ],
      }),
    )
    expect((await run(r, 'ttylate')).outcome).toBe('pass')
  })

  it('marks the step as a terminal run in the evidence transcript', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'ttyev.yaml',
      scenario({
        id: 'ttyev',
        steps: [{ run: ['publish'], tty: true, stdin: 'y\n', expect: { exit: 0 } }],
      }),
    )
    const result = await run(r, 'ttyev')
    expect(result.outcome).toBe('pass')
    const invocation = JSON.parse(
      fs.readFileSync(path.join(r, result.evidencePath!, 'invocation.json'), 'utf-8'),
    )
    expect(invocation.steps[0].tty).toBe(true)
  })
})

describe('the combined `output` matcher', () => {
  it('matches text on EITHER stream — the assertion no stream pins', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'output.yaml',
      scenario({
        id: 'outputstep',
        steps: [
          {
            run: ['warn'],
            expect: {
              exit: 0,
              // One is on stdout, the other on stderr — only the combined view has both.
              output: { matches: '^(?=[\\s\\S]*scanned 3 files)(?=[\\s\\S]*skipped bulk\\.js)[\\s\\S]*$' },
            },
          },
        ],
      }),
    )
    expect((await run(r, 'outputstep')).outcome).toBe('pass')
  })

  it('fails naming `output` as the subject when it misses', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'outputfail.yaml',
      scenario({
        id: 'outputfail',
        steps: [{ run: ['warn'], expect: { exit: 0, output: { contains: 'no such text' } } }],
      }),
    )
    const result = await run(r, 'outputfail')
    expect(result.outcome).toBe('fail')
    expect(result.failure?.expected).toContain('output contains')
  })
})

describe('${sandbox} interpolation', () => {
  it('substitutes the sandbox root in seeds, env, argv and expectations', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'sandbox.yaml',
      scenario({
        id: 'sandboxtoken',
        setup: {
          // The path is a token in the seeded CONTENT and in the env value.
          files: { 'deep/.keep': '', 'config.txt': 'root=${sandbox}\n' },
          env: { TOOL_HOME: '${sandbox}/home' },
        },
        steps: [
          // The child sees the resolved absolute path, not the literal token.
          { run: ['env', 'TOOL_HOME'], expect: { exit: 0, stdout: { matches: '^TOOL_HOME=/.*/home\\n$' } } },
          { run: ['show', 'config.txt'], expect: { exit: 0, stdout: { matches: '^root=/[^$]*\\n$' } } },
          // An argv token resolves too, and so does the asserted path it produced.
          // `${sandbox}` is the sandbox CWD, so the absolute form and the relative
          // path name the SAME file — which is what makes the assertion below hold.
          { run: ['note', '${sandbox}/deep/written.txt', 'hi'], expect: { exit: 0, files: { 'deep/written.txt': { contains: 'hi' } } } },
        ],
      }),
    )
    expect((await run(r, 'sandboxtoken')).outcome).toBe('pass')
  })

  it('is a literal substring swap, applied to setup and expectations alike', () => {
    expect(applySandbox('${sandbox}/home:${sandbox}', '/tmp/sb')).toBe('/tmp/sb/home:/tmp/sb')
    expect(applySandbox('nothing to do', '/tmp/sb')).toBe('nothing to do')
    const resolved = applySandboxSetup(
      { files: { '${sandbox}.txt': 'at ${sandbox}' }, env: { H: '${sandbox}/home' }, git: { root: '${sandbox}/r', staged: ['${sandbox}/a'] } },
      '/tmp/sb',
    )
    expect(resolved?.files).toEqual({ '/tmp/sb.txt': 'at /tmp/sb' })
    expect(resolved?.env).toEqual({ H: '/tmp/sb/home' })
    expect(resolved?.git).toMatchObject({ root: '/tmp/sb/r', staged: ['/tmp/sb/a'] })
  })
})

describe('milestone lists on executed steps', () => {
  it('reports the POSITION of a failing step tagged with claim ids and a position', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'milestones.yaml',
      scenario({
        id: 'milestones',
        steps: [
          { run: ['--version'], expect: { exit: 0 }, milestone: ['a-claim-id'] },
          { run: ['boom'], expect: { exit: 0 }, milestone: [2, 'another-claim'] },
        ],
      }),
    )
    const result = await run(r, 'milestones')
    expect(result.outcome).toBe('fail')
    expect(result.failedMilestone).toBe(2)
    // A milestoned step failing is drift, never a blocked precondition.
    expect(result.blockedPrecondition).toBeUndefined()
  })

  it('a claim-only tag still counts as a milestone for the precondition rule', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'claimonly.yaml',
      scenario({
        id: 'claimonly',
        steps: [
          // Plumbing (no milestone) that fails, in a scenario whose OTHER step is
          // tagged only by claim id: the annotation must still fire.
          { run: ['boom'], expect: { exit: 0 } },
          { run: ['--version'], expect: { exit: 0 }, milestone: 'a-claim-id' },
        ],
      }),
    )
    const result = await run(r, 'claimonly')
    expect(result.outcome).toBe('fail')
    expect(result.blockedPrecondition).toBe(true)
    expect(result.failedMilestone).toBeUndefined()
  })
})

describe('git steps are hermetic end to end', () => {
  it('never touches the repository the runner itself lives in', async () => {
    const r = repo()
    writeRecipe(r)
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: r })
    const before = execFileSync('git', ['status', '--porcelain'], { cwd: r, encoding: 'utf-8' })
    writeScenario(
      r,
      'hermetic.yaml',
      scenario({
        id: 'hermetic',
        setup: { files: { 'a.txt': 'a\n' }, git: {} },
        steps: [
          { git: ['add', '.'], expect: { exit: 0 } },
          { git: ['commit', '-m', 'sandbox only'], expect: { exit: 0 } },
        ],
      }),
    )
    expect((await run(r, 'hermetic')).outcome).toBe('pass')
    // The sandbox commit did not reach the host repo (no commits, same status).
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: r, encoding: 'utf-8' })).toBe(before)
    expect(() => execFileSync('git', ['log', '-1'], { cwd: r, stdio: 'pipe' })).toThrow()
  })
})
