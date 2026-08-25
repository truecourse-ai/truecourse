/**
 * The build step: publish `src/` as the runnable `dist/` tree the `bin` entry
 * points at, and make the entrypoint executable. Dependency-free on purpose so
 * the build works offline.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.dirname(new URL(import.meta.url).pathname)
const dist = path.join(root, 'dist')

fs.rmSync(dist, { recursive: true, force: true })
fs.cpSync(path.join(root, 'src'), dist, { recursive: true })
fs.chmodSync(path.join(dist, 'cli.js'), 0o755)

process.stdout.write('covergate: built dist/\n')
