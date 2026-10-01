/** Real Playwright garbage collection must stay inside the repository cache. */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'
import { constructChildEnv, BUILD_PASSTHROUGH } from '@truecourse/guard-runner'

it('repository Playwright garbage collection leaves the release browser intact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-browser-cache-'))
  const saved = process.env.PLAYWRIGHT_BROWSERS_PATH
  try {
    const runnerRequire = createRequire(new URL('../../packages/guard-runner/package.json', import.meta.url))
    const packageFile = runnerRequire.resolve('playwright-core/package.json')
    const playwright = path.dirname(packageFile)
    const cli = path.join(playwright, 'cli.js')
    const runnerCache = path.join(root, 'release/browsers')
    process.env.PLAYWRIGHT_BROWSERS_PATH = runnerCache
    const runnerEnv = { ...process.env }
    const executable = execFileSync(process.execPath, ['-e',
      `process.stdout.write(require(${JSON.stringify(playwright)}).chromium.executablePath())`,
    ], { env: runnerEnv, encoding: 'utf8' })
    fs.mkdirSync(path.dirname(executable), { recursive: true })
    fs.writeFileSync(executable, 'runner browser fixture')

    const home = path.join(root, 'repository-home')
    const repoCache = path.join(home, os.platform() === 'darwin'
      ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright')
    const staleBrowser = path.join(repoCache, 'chromium-999999')
    fs.mkdirSync(staleBrowser, { recursive: true })
    fs.mkdirSync(path.join(repoCache, '.links'))
    const repositoryEnv = constructChildEnv({
      passthrough: BUILD_PASSTHROUGH,
      recipeEnv: { HOME: home, XDG_CACHE_HOME: path.join(home, '.cache') },
    })
    expect(repositoryEnv.PLAYWRIGHT_BROWSERS_PATH).toBeUndefined()
    execFileSync(process.execPath, [cli, 'uninstall', '--all'], { env: repositoryEnv })
    expect(fs.existsSync(staleBrowser)).toBe(false)
    expect(fs.readFileSync(executable, 'utf8')).toBe('runner browser fixture')
  } finally {
    if (saved === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH
    else process.env.PLAYWRIGHT_BROWSERS_PATH = saved
    fs.rmSync(root, { recursive: true, force: true })
  }
})
