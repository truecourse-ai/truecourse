/**
 * The UPLOAD verb, end to end in a real browser, against `guard-fixture-web`'s
 * `/upload` page — which carries both shapes a real app has: a labelled visible
 * `input[type=file]`, and a hidden input behind a `role=button` (the react-dropzone
 * shape every "Upload Document" button in the wild is).
 *
 * What this suite is really asserting:
 *  - the bytes ARRIVE — the page reports the name, the size and the first bytes it
 *    actually received, so no test here can pass on a chooser that opened and took
 *    nothing;
 *  - the step asserts only that it could TAKE the action; the `expect` block judges
 *    the effect, and a wrong expectation fails on ITS subject, not on the upload;
 *  - a control that opens no chooser is a FAIL that names itself, never a silent
 *    green (the whole reason `setInputFiles` on a CSS-addressed input is refused);
 *  - a payload that cannot be materialized is an ERROR — nothing about the app was
 *    observed;
 *  - evidence carries the file's identity (name, size, sha256) and never its bytes.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { GuardSandboxScenario, GuardSandboxStep, GuardWebStep } from '@truecourse/shared'
import {
  isBrowserInstalled,
  loadRecipe,
  newRunNonce,
  resolveWebStep,
  resolveWebSurface,
  runScenario,
  scenarioUnique,
  type ResolvedWebSurface,
} from '@truecourse/guard-runner'
import {
  FIXTURE_BIN,
  makeTempRepo,
  playwrightBrowserPids,
  rmrf,
  scenario,
  specBinds,
  writeSpecDoc,
} from './helpers.js'

/** Absolute path to the fixture WEB app — the `/upload` page is its upload surface. */
const FIXTURE_WEB_SERVER = fileURLToPath(
  new URL('../fixtures/guard-fixture-web/server.mjs', import.meta.url),
)

/** A browser step is a real browser: generous, but still bounded. */
const TEST_TIMEOUT_MS = 60_000

/** A repo whose recipe runs `relkit` and serves the fixture web app. */
function makeWebRepo(): string {
  const repo = makeTempRepo()
  const recipe = {
    build: 'true',
    entry: ['node', FIXTURE_BIN],
    web: { serve: ['node', FIXTURE_WEB_SERVER], healthPath: '/health', readyTimeoutMs: 20_000 },
  }
  const target = path.join(repo, '.truecourse', 'scenarios', 'recipe.json')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(recipe, null, 2))
  writeSpecDoc(repo)
  return repo
}

/** The recipe's resolved web surface, read back through the real recipe loader. */
function webSurfaceOf(repo: string): ResolvedWebSurface | null {
  const loaded = loadRecipe(repo, path.join(repo, '.truecourse', 'scenarios', 'recipe.json'))
  if (!loaded) throw new Error('the fixture recipe did not load')
  return resolveWebSurface(loaded.recipe)
}

interface RunOverrides {
  setup?: GuardSandboxScenario['setup']
  /** The seed's fixture manifest, as the runner hands it to a sandbox scenario. */
  fixtures?: ReadonlyMap<string, Record<string, unknown>>
  /** The recipe declares `api.seed` — what makes "the seed did not run" sayable. */
  seedDeclared?: boolean
}

/** Run one scenario in its own sandbox, with the fixture recipe's web surface. */
async function run(
  repo: string,
  steps: GuardSandboxStep[],
  id = 'web.upload.cli.1',
  overrides: RunOverrides = {},
) {
  const s: GuardSandboxScenario = scenario({
    id,
    steps,
    binds: specBinds('a/b'),
    ...(overrides.setup ? { setup: overrides.setup } : {}),
  })
  const surface = webSurfaceOf(repo)
  return await runScenario(s, {
    repoRoot: repo,
    runId: 'run-upload',
    resolvedEntry: ['node', FIXTURE_BIN],
    unique: scenarioUnique(newRunNonce(), s.id),
    stepTimeoutMs: 20_000,
    capturePassEvidence: true,
    ...(surface ? { web: surface } : {}),
    ...(overrides.fixtures ? { fixtures: overrides.fixtures } : {}),
    ...(overrides.seedDeclared ? { seedDeclared: true } : {}),
  })
}

/** The evidence directory a run of `id` left behind. */
function evidenceDir(repo: string, id = 'web.upload.cli.1'): string {
  return path.join(repo, '.truecourse', 'guard', 'evidence', 'run-upload', id)
}

/** The transcript of that run. */
function transcript(repo: string, id = 'web.upload.cli.1'): string {
  return fs.readFileSync(path.join(evidenceDir(repo, id), 'transcript.txt'), 'utf-8')
}

describe('the upload step’s token pass', () => {
  it('resolves the locator name, the filename, the authored text and the path', () => {
    // `isWebExpectStep`'s negation decides this: an upload step read as assert-only
    // falls through the token pass with every authored string still a template.
    const resolved = resolveWebStep(
      {
        driver: 'web',
        upload: { role: 'button', name: 'Upload ${unique}' },
        file: { text: 'id=${unique}', as: 'contract-${unique}.pdf' },
        expect: { text: { contains: 'contract-${unique}.pdf' } },
      } as GuardWebStep,
      (text) => text.split('${unique}').join('u42'),
    ) as Extract<GuardWebStep, { upload: unknown }>
    expect(resolved.upload.name).toBe('Upload u42')
    expect(resolved.file.as).toBe('contract-u42.pdf')
    expect(resolved.file.text).toBe('id=u42')
    expect(resolved.expect?.text?.contains).toBe('contract-u42.pdf')

    const fromPath = resolveWebStep(
      {
        driver: 'web',
        upload: { role: 'button', name: 'Attach' },
        file: { path: '${sandbox}/out/report.json' },
      } as GuardWebStep,
      (text) => text.split('${sandbox}').join('/tmp/box'),
    ) as Extract<GuardWebStep, { upload: unknown }>
    expect(fromPath.file.path).toBe('/tmp/box/out/report.json')
  })
})

describe('the upload verb', () => {
  let repo: string
  let pidsBefore: number[]

  beforeAll(async () => {
    // The suite is meaningless without the browser, and skipping silently would be
    // the "green for the wrong reason" this whole engine exists to prevent.
    expect(
      await isBrowserInstalled(),
      'playwright-core + chromium must be installed for the web driver suite',
    ).toBe(true)
    pidsBefore = playwrightBrowserPids()
    repo = makeWebRepo()
  })

  afterAll(() => {
    rmrf(repo)
  })

  it(
    'hands authored text to a VISIBLE file input, and the page reports the bytes it got',
    async () => {
      const result = await run(repo, [
        { driver: 'web', navigate: '/upload' },
        {
          driver: 'web',
          upload: { role: 'button', name: 'Attachment' },
          file: { text: 'email,role\nada@example.test,admin\n', as: 'members.csv' },
          expect: { text: { contains: 'members.csv · 34 bytes · text/csv · email,role' } },
        },
      ])
      expect(result.outcome).toBe('pass')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'hands a file to a HIDDEN input behind a role=button — the react-dropzone shape',
    async () => {
      // The input carries `display:none` and no role at all; the only thing a user
      // (or this vocabulary) can address is the button, whose click opens the
      // chooser. This is documenso's "Upload Document" exactly.
      const result = await run(
        repo,
        [
          { driver: 'web', navigate: '/upload' },
          {
            driver: 'web',
            upload: { role: 'button', name: 'Choose a file' },
            file: { text: 'hello', as: 'greeting.txt' },
            expect: { text: { contains: 'greeting.txt · 5 bytes · text/plain · hello' } },
          },
        ],
        'web.upload-hidden.cli.1',
      )
      expect(result.outcome).toBe('pass')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'hands BASE64 bytes through unmangled — a real PNG arrives byte for byte',
    async () => {
      // A 1×1 PNG: binary, with a signature the page reports back as hex. Anything
      // that round-tripped these bytes through UTF-8 would corrupt them.
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      )
      const result = await run(
        repo,
        [
          { driver: 'web', navigate: '/upload' },
          {
            driver: 'web',
            upload: { role: 'button', name: 'Attachment' },
            file: { base64: png.toString('base64'), as: 'dot.png' },
            expect: { text: { contains: `dot.png · ${png.length} bytes · image/png · hex:89504e470d0a1a0a` } },
          },
        ],
        'web.upload-base64.cli.1',
      )
      expect(result.outcome).toBe('pass')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'uploads a file the scenario’s OWN world holds, under its own name',
    async () => {
      const result = await run(
        repo,
        [
          { driver: 'web', navigate: '/upload' },
          {
            driver: 'web',
            upload: { role: 'button', name: 'Attachment' },
            file: { path: 'out/report.json' },
            // No `as`: the file is named by its own basename.
            expect: { text: { contains: 'report.json · 11 bytes · application/json · {"ok":true}' } },
          },
        ],
        'web.upload-path.cli.1',
        // Seeded into the very sandbox the browser's surface serves.
        { setup: { files: { 'out/report.json': '{"ok":true}' } } },
      )
      expect(result.outcome).toBe('pass')
      expect(transcript(repo, 'web.upload-path.cli.1')).toContain('upload “report.json”')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    '`${unique}` reaches the filename the APP sees — two runs never collide in its data',
    async () => {
      const seen: string[] = []
      for (const id of ['web.upload-unique-a.cli.1', 'web.upload-unique-b.cli.1']) {
        const result = await run(
          repo,
          [
            { driver: 'web', navigate: '/upload' },
            {
              driver: 'web',
              upload: { role: 'button', name: 'Attachment' },
              file: { text: 'x', as: 'contract-${unique}.pdf' },
              expect: { text: { matches: 'contract-[a-z0-9]+\\.pdf · 1 bytes · application/pdf' } },
            },
          ],
          id,
        )
        expect(result.outcome).toBe('pass')
        seen.push(/upload “(contract-[^”]+)”/.exec(transcript(repo, id))![1])
      }
      expect(seen[0]).not.toBe(seen[1])
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'a control that opens NO file chooser FAILS naming itself',
    async () => {
      // The one failure a `setInputFiles` shortcut would have hidden: the button is
      // there, it is clickable, and nothing behind it asks for a file.
      const result = await run(
        repo,
        [
          { driver: 'web', navigate: '/upload' },
          {
            driver: 'web',
            upload: { role: 'button', name: 'Not an upload' },
            file: { text: 'x', as: 'a.txt' },
            timeoutMs: 3_000,
          },
        ],
        'web.upload-nochooser.cli.1',
      )
      expect(result.outcome).toBe('fail')
      expect(result.failure?.step).toBe(2)
      expect(result.failure?.actual).toContain('opened no file chooser')
      const diff = fs.readFileSync(
        path.join(evidenceDir(repo, 'web.upload-nochooser.cli.1'), 'diff.txt'),
        'utf-8',
      )
      expect(diff).toContain('visible page text')
      expect(fs.existsSync(path.join(evidenceDir(repo, 'web.upload-nochooser.cli.1'), 'step-2.png'))).toBe(true)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'a control that is not there fails exactly as a click does',
    async () => {
      const result = await run(
        repo,
        [
          { driver: 'web', navigate: '/upload' },
          {
            driver: 'web',
            upload: { role: 'button', name: 'Publish' },
            file: { text: 'x', as: 'a.txt' },
            timeoutMs: 1_500,
          },
        ],
        'web.upload-missing.cli.1',
      )
      expect(result.outcome).toBe('fail')
      expect(result.failure?.actual).toContain('no button named “Publish” is on the page')
      // The role inventory — "it is called something else now".
      expect(
        fs.readFileSync(path.join(evidenceDir(repo, 'web.upload-missing.cli.1'), 'diff.txt'), 'utf-8'),
      ).toContain('Choose a file')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'a path that escapes the sandbox is an ERROR — nothing about the app was observed',
    async () => {
      const result = await run(
        repo,
        [
          { driver: 'web', navigate: '/upload' },
          {
            driver: 'web',
            upload: { role: 'button', name: 'Attachment' },
            file: { path: '../../etc/passwd' },
            timeoutMs: 3_000,
          },
        ],
        'web.upload-escape.cli.1',
      )
      expect(result.outcome).toBe('error')
      expect(result.failure?.actual).toContain('upload.file.path')
      expect(result.failure?.actual).toContain('escapes the sandbox')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'a file over the ceiling is refused saying its size, and nothing is sent',
    async () => {
      const result = await run(
        repo,
        [
          { driver: 'web', navigate: '/upload' },
          {
            driver: 'web',
            upload: { role: 'button', name: 'Attachment' },
            file: { text: 'x'.repeat(10 * 1024 * 1024 + 1), as: 'huge.txt' },
            timeoutMs: 5_000,
          },
        ],
        'web.upload-huge.cli.1',
      )
      expect(result.outcome).toBe('error')
      expect(result.failure?.actual).toContain('10485761 bytes')
      expect(result.failure?.actual).toContain('10485760')
      // The page never heard about it.
      expect(transcript(repo, 'web.upload-huge.cli.1')).not.toContain('huge.txt · ')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'the EXPECT block judges the effect — a wrong expectation fails on ITS subject',
    async () => {
      const result = await run(
        repo,
        [
          { driver: 'web', navigate: '/upload' },
          {
            driver: 'web',
            upload: { role: 'button', name: 'Attachment' },
            file: { text: 'hi', as: 'note.txt' },
            expect: { text: { contains: 'Totally Different Product' } },
            timeoutMs: 3_000,
          },
        ],
        'web.upload-expect.cli.1',
      )
      expect(result.outcome).toBe('fail')
      // The upload itself SUCCEEDED — the failure is the text member, and the page's
      // own answer proves the bytes arrived.
      expect(result.failure?.expected).toContain('the page text contains')
      expect(result.failure?.actual).toContain('note.txt · 2 bytes')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'the app’s OWN refusal is a claim the expectation states — an accept filter says no',
    async () => {
      const result = await run(
        repo,
        [
          { driver: 'web', navigate: '/upload' },
          {
            driver: 'web',
            upload: { role: 'button', name: 'PDF only' },
            file: { text: 'not a pdf', as: 'notes.txt' },
            // The step's action succeeded; what the APP did with the file is what
            // this asserts.
            expect: { text: { contains: 'rejected: notes.txt is not a .pdf' } },
          },
        ],
        'web.upload-accept.cli.1',
      )
      expect(result.outcome).toBe('pass')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'evidence records the file’s IDENTITY and never its bytes',
    async () => {
      const secret = 'BEGIN-SECRET-PAYLOAD-do-not-transcribe'
      const result = await run(
        repo,
        [
          { driver: 'web', navigate: '/upload' },
          {
            driver: 'web',
            upload: { role: 'button', name: 'Attachment' },
            file: { text: secret, as: 'secret.txt' },
            expect: { text: { contains: 'secret.txt · 38 bytes' } },
          },
        ],
        'web.upload-evidence.cli.1',
      )
      expect(result.outcome).toBe('pass')
      const text = transcript(repo, 'web.upload-evidence.cli.1')
      const sha = crypto.createHash('sha256').update(secret).digest('hex')
      expect(text).toContain('file:     secret.txt · 38 bytes · sha256:')
      expect(text).toContain(sha.slice(0, 12))
      // The bytes rode nowhere: the page's own report quotes the first of them, and
      // that is the page's doing — the record of the STEP carries none.
      const bundle = JSON.parse(
        fs.readFileSync(path.join(evidenceDir(repo, 'web.upload-evidence.cli.1'), 'invocation.json'), 'utf-8'),
      ) as { steps: { index: number; web?: { upload?: { name: string; bytes: number; sha256: string } } }[] }
      const upload = bundle.steps.find((s) => s.index === 2)?.web?.upload
      expect(upload).toEqual({ name: 'secret.txt', bytes: 38, sha256: sha })
      expect(JSON.stringify(upload)).not.toContain(secret)
      expect(fs.existsSync(path.join(evidenceDir(repo, 'web.upload-evidence.cli.1'), 'step-2.png'))).toBe(true)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'a chooser an EARLIER click left open is never consumed by a later upload',
    async () => {
      // Step 2 clicks the hidden-input button and answers nothing: the chooser it
      // opened is parked. Step 3's upload must land on ITS OWN control, and the
      // page must report the file against the visible input — not against the
      // control the stale chooser belonged to.
      const result = await run(
        repo,
        [
          { driver: 'web', navigate: '/upload' },
          { driver: 'web', click: { role: 'button', name: 'Choose a file' } },
          {
            driver: 'web',
            upload: { role: 'button', name: 'Attachment' },
            file: { text: 'later', as: 'later.txt' },
            expect: { text: { contains: 'visible: later.txt · 5 bytes' } },
          },
        ],
        'web.upload-stale.cli.1',
      )
      expect(result.outcome).toBe('pass')
    },
    TEST_TIMEOUT_MS,
  )

  it('leaves no chromium behind across the whole suite', () => {
    expect(playwrightBrowserPids().filter((pid) => !pidsBefore.includes(pid))).toEqual([])
  })
})

/**
 * G3a — the SEED's fixtures, reachable from a sandbox scenario. Until this, a
 * `{{fixture:…}}` written in a cli or web step stayed literal text: the placeholder
 * kinds are active only where their map is supplied, and the sandbox path was handed
 * none. The upload verb is what made that unlivable — the canonical seeded document
 * IS a fixture field, and inlining it per scenario is 20 KB of unreviewable base64.
 */
describe('fixtures in a sandbox scenario', () => {
  let repo: string
  let pidsBefore: number[]

  /** A one-pixel PNG, as a seed publishes one: base64 in a fixture field. */
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  const seeded = new Map<string, Record<string, unknown>>([
    [
      'doc',
      {
        base64: png.toString('base64'),
        title: 'the seeded document',
        // A seeded value that READS as a fixture reference — the injection probe.
        tricky: '{{fixture:doc.title}}',
      },
    ],
  ])

  beforeAll(async () => {
    expect(
      await isBrowserInstalled(),
      'playwright-core + chromium must be installed for the web driver suite',
    ).toBe(true)
    pidsBefore = playwrightBrowserPids()
    repo = makeWebRepo()
  })

  afterAll(() => {
    rmrf(repo)
  })

  it(
    'resolves `{{fixture:…}}` in an upload’s bytes and in the name beside them',
    async () => {
      const result = await run(
        repo,
        [
          { driver: 'web', navigate: '/upload' },
          {
            driver: 'web',
            upload: { role: 'button', name: 'Attachment' },
            file: { base64: '{{fixture:doc.base64}}', as: '{{fixture:doc.title}}-${unique}.png' },
            expect: { text: { matches: `the seeded document-[a-z0-9]+\\.png · ${png.length} bytes · image/png` } },
          },
        ],
        'web.fixture-upload.cli.1',
        { fixtures: seeded },
      )
      expect(result.outcome).toBe('pass')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'a fixture the seed never emitted is a scenario ERROR naming it',
    async () => {
      const result = await run(
        repo,
        [
          { driver: 'web', navigate: '/upload' },
          {
            driver: 'web',
            upload: { role: 'button', name: 'Attachment' },
            file: { base64: '{{fixture:doc.missing}}', as: 'x.png' },
          },
        ],
        'web.fixture-unknown.cli.1',
        { fixtures: seeded },
      )
      expect(result.outcome).toBe('error')
      expect(result.failure?.actual).toContain('{{fixture:doc.missing}}')
      expect(result.failure?.expected).toContain('doc.missing')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'a fixture reference with no seed run names THAT reason, not "no such fixture"',
    async () => {
      // A context that declares `api.seed` and carries no fixtures: nothing seeded,
      // so telling the author their fixture does not exist would send them to edit a
      // manifest that is perfectly correct. Item 98 removed the SELECTION that used
      // to produce this (a run now prepares the world for anything that needs it —
      // see `run-driver-preparation.test.ts`), so the state is assembled directly
      // here; the two failures must still read differently.
      const result = await run(
        repo,
        [{ run: ['note', 'f.txt', '{{fixture:doc.base64}}'], expect: { exit: 0 } }],
        'web.fixture-noseed.cli.1',
        { seedDeclared: true },
      )
      expect(result.outcome).toBe('error')
      expect(result.failure?.actual).toContain('the seed did not run for this selection')
      expect(result.failure?.actual).toContain('{{fixture:doc.base64}}')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'a `${captured:…}` that CONTAINS a fixture reference is never expanded',
    async () => {
      // Bounded injection, the api driver's rule applied to the sandbox: placeholders
      // are located in the RAW template and `${…}` runs only on the literal segments
      // between them, so a value the PROGRAM printed can never become a fixture read.
      // `doc.tricky` is itself the text `{{fixture:doc.title}}` — one pass inserts it
      // VERBATIM, the program prints it back, and the step after it writes it out
      // still unexpanded.
      const result = await run(
        repo,
        [
          { write: { 'echo.txt': '{{fixture:doc.tricky}}' } },
          { run: ['show', 'echo.txt'], capture: { echoed: { pattern: '(.+)' } }, expect: { exit: 0 } },
          {
            run: ['note', 'out.txt', '${captured:echoed}'],
            expect: { exit: 0, files: { 'out.txt': { equals: '{{fixture:doc.title}}' } } },
          },
        ],
        'web.fixture-injection.cli.1',
        { fixtures: seeded },
      )
      expect(result.outcome).toBe('pass')
    },
    TEST_TIMEOUT_MS,
  )

  it('leaves no chromium behind', () => {
    expect(playwrightBrowserPids().filter((pid) => !pidsBefore.includes(pid))).toEqual([])
  })
})
