#!/usr/bin/env node
/**
 * Fixture seed command for guard api-driver tests. Honors the runner contract:
 * writes its manifest JSON to the file named by `GUARD_SEED_OUT`. The manifest it
 * emits is driven by env so a test can shape it without a bespoke script:
 *   - `SEED_FAIL`   — if set, print it to stderr and exit non-zero (a failing seed).
 *   - `SEED_MANIFEST` — the JSON manifest to write (defaults to `{}`).
 */

import fs from 'node:fs'

if (process.env.SEED_FAIL) {
  console.error(`seed failed: ${process.env.SEED_FAIL}`)
  process.exit(1)
}

const manifest = process.env.SEED_MANIFEST ?? '{}'
fs.writeFileSync(process.env.GUARD_SEED_OUT, manifest)
