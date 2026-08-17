/**
 * MATERIALIZE the file an `upload` step hands the page: the authored declaration
 * (`base64` | `text` | `path`, plus the name and the type it arrives under) turned
 * into the bytes Playwright's file chooser takes.
 *
 * The bytes never touch the disk. `FileChooser.setFiles` accepts a payload
 * (`{ name, mimeType, buffer }`), so a base64 fixture goes fixture → Buffer →
 * browser without a temp file anyone would have to clean up — and a `path` file is
 * READ from the sandbox rather than copied into it.
 *
 * Every failure here is the SAME kind of failure: nothing about the app was
 * observed, so the caller settles an `error`, never a `fail`. A malformed base64
 * blob, a path that escapes the sandbox, a file that is not there, a payload past
 * the ceiling — each names itself, because a scenario that silently uploaded
 * truncated or empty bytes would fail later for a reason it never stated.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { GuardWebFile } from '@truecourse/shared'
import { GUARD_WEB_FILE_MAX_BYTES, webFileName, webFileType } from '@truecourse/shared'
import { resolveInSandbox, SandboxError } from '../sandbox.js'

/** The bytes and the identity one uploaded file arrives under. */
export interface WebFilePayload {
  /** The filename the app is shown. */
  name: string
  /** The MIME type the app is offered. */
  mimeType: string
  /** The bytes themselves — handed to the chooser and to nothing else. */
  buffer: Buffer
  /** sha256 of the bytes, hex. The evidence's record of the file, in place of it. */
  sha256: string
}

export type MaterializeWebFileResult =
  | { ok: true; file: WebFilePayload }
  /** One line, in the words the scenario's `error` will carry. */
  | { ok: false; reason: string }

/** Base64 as the decoder saw it: whitespace is layout, not payload. */
function compactBase64(value: string): string {
  return value.replace(/\s+/g, '')
}

/**
 * Decode base64 STRICTLY. `Buffer.from(…, 'base64')` silently stops at the first
 * character it cannot read, so a fixture that arrived truncated (or a `{{fixture:…}}`
 * that resolved to prose) would upload a plausible-looking prefix and the scenario
 * would fail somewhere else entirely. Re-encoding and comparing is what turns that
 * into a named error.
 */
function decodeBase64(value: string): { ok: true; buffer: Buffer } | { ok: false; reason: string } {
  const compact = compactBase64(value)
  const buffer = Buffer.from(compact, 'base64')
  // The canonical re-encoding differs from the source only in its padding, which
  // Node accepts either way; everything else means bytes were dropped.
  if (buffer.toString('base64').replace(/=+$/, '') !== compact.replace(/=+$/, '')) {
    return {
      ok: false,
      reason:
        'the file’s `base64` is not valid base64 — it decoded to a truncated prefix, ' +
        'which would have uploaded bytes no one authored',
    }
  }
  return { ok: true, buffer }
}

/** The bytes a declaration names, or the reason they could not be read. */
function readBytes(
  file: GuardWebFile,
  sandboxCwd: string,
): { ok: true; buffer: Buffer } | { ok: false; reason: string } {
  if (file.base64 !== undefined) return decodeBase64(file.base64)
  if (file.text !== undefined) return { ok: true, buffer: Buffer.from(file.text, 'utf-8') }
  const rel = file.path as string
  let resolved: string
  try {
    // THE containment rule, the same one a `write` target and a step's `cwd` go
    // through: a scenario reaches its own world and never the developer's.
    resolved = resolveInSandbox(sandboxCwd, rel, 'upload.file.path')
  } catch (e) {
    return { ok: false, reason: e instanceof SandboxError ? e.message : String(e) }
  }
  try {
    return { ok: true, buffer: fs.readFileSync(resolved) }
  } catch (e) {
    return {
      ok: false,
      reason: `upload.file.path ${rel} could not be read: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

/**
 * The payload an `upload` step hands the chooser — or the one line saying why it has
 * none. The name is the authored `as`, else the file's own basename; the type is the
 * authored `type`, else the one its extension names (the schema already refused a
 * name neither answers, so a miss here can only be a step built by hand).
 */
export function materializeWebFile(file: GuardWebFile, sandboxCwd: string): MaterializeWebFileResult {
  const read = readBytes(file, sandboxCwd)
  if (!read.ok) return read
  const name = file.as ?? path.basename(file.path ?? '')
  if (name.length === 0) return { ok: false, reason: 'the file has no name — name it with `as`' }
  const mimeType = webFileType(file)
  if (mimeType === null) {
    return {
      ok: false,
      reason: `the type of “${webFileName(file)}” could not be read from its name — name it with \`type\``,
    }
  }
  if (read.buffer.length > GUARD_WEB_FILE_MAX_BYTES) {
    return {
      ok: false,
      reason:
        `“${name}” is ${read.buffer.length} bytes, past the ${GUARD_WEB_FILE_MAX_BYTES}-byte ceiling one ` +
        'uploaded file may carry — nothing was sent',
    }
  }
  return {
    ok: true,
    file: {
      name,
      mimeType,
      buffer: read.buffer,
      sha256: crypto.createHash('sha256').update(read.buffer).digest('hex'),
    },
  }
}
