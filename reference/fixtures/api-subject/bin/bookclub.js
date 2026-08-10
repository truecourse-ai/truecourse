#!/usr/bin/env node
/**
 * `bookclub` — the operator CLI.
 *
 * It is a separate program from the HTTP service and never opens a database
 * connection: it reports the configuration the service would run with, and
 * normalises ISBNs with the same module the service validates them through.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COVERS_BASE_URL, DATABASE_URL, PORT, redactedDatabaseUrl } from '../src/config.js'
import { normalizeIsbn } from '../src/isbn.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const VERSION = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf-8')).version

const USAGE = `Usage: bookclub <command> [options]

Commands:
  config          Print the configuration the service would run with
  isbn <value>    Print an ISBN-10 or ISBN-13 normalised to 13 digits

Options:
  -h, --help      Print this help and exit
  -V, --version   Print the version and exit`

/** The connection URL's scheme must be one the service can speak. */
const SUPPORTED_SCHEMES = ['postgres', 'postgresql']

function fail(message) {
  process.stderr.write(`error: ${message}\n`)
  process.exit(2)
}

function main(argv) {
  if (argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(`${USAGE}\n`)
    return
  }
  if (argv.includes('-V') || argv.includes('--version')) {
    process.stdout.write(`bookclub ${VERSION}\n`)
    return
  }

  const [command, ...rest] = argv
  if (command === undefined) {
    process.stderr.write(`${USAGE}\n`)
    process.exit(2)
  }

  if (command === 'config') {
    const scheme = DATABASE_URL.slice(0, Math.max(0, DATABASE_URL.indexOf(':')))
    if (!SUPPORTED_SCHEMES.includes(scheme)) {
      fail(`unsupported database scheme "${scheme}" — bookclub speaks ${SUPPORTED_SCHEMES.join(' and ')}`)
    }
    process.stdout.write(`database: ${redactedDatabaseUrl()}\n`)
    process.stdout.write(`port: ${PORT}\n`)
    process.stdout.write(`covers: ${COVERS_BASE_URL}\n`)
    return
  }

  if (command === 'isbn') {
    const value = rest[0]
    if (value === undefined) fail('isbn needs a value')
    const normalized = normalizeIsbn(value)
    if (normalized === null) fail(`"${value}" is not a valid ISBN`)
    process.stdout.write(`${normalized}\n`)
    return
  }

  fail(`unknown command "${command}"`)
}

main(process.argv.slice(2))
