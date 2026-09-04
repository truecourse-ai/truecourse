/**
 * The `patch` step's applier: set or remove named key paths inside a JSON document,
 * leaving everything else as found.
 *
 * Pure over TEXT — it reads no files and writes none — so every rule the step
 * promises is testable on its own, and the runner's job shrinks to read, call, write.
 * The messages here ARE the evidence a reader gets when a patch fails, so each one
 * names the file, the operation as authored, and the deepest key path that does
 * exist; a scenario owner should be able to fix the step from the sentence alone.
 */

import {
  guardKeyPathSegments,
  guardKeyPathText,
  type GuardJsonValue,
} from '@truecourse/shared'

/** A patch that cannot mean what it says — always the step failing, never a warning. */
export class PatchError extends Error {}

// --- Locating a syntax error --------------------------------------------

/**
 * WHERE a document stops being valid JSON: the 0-based offset, and the 1-based line
 * and column a reader counts to.
 *
 * `JSON.parse` alone cannot answer this. V8 reports a position for some defect
 * classes ("Expected double-quoted property name … at position 22") and, for the
 * unexpected-token class, quotes a WINDOW of the source instead with no offset at
 * all — so a patch that relied on the parser's message would locate some failures
 * and shrug at others, and would change its mind with the runtime. The scan below is
 * a strict RFC 8259 well-formedness pass whose ONLY output is that offset, so the
 * evidence says the same thing on every machine.
 */
export interface JsonSyntaxPosition {
  position: number
  line: number
  column: number
}

class ScanError extends Error {
  constructor(readonly at: number) {
    super('json scan')
  }
}

const DIGITS = /[0-9]/
const HEX = /[0-9a-fA-F]/

/** The first offset at which `text` stops being valid JSON, or null when it is. */
export function jsonSyntaxPosition(text: string): JsonSyntaxPosition | null {
  let i = 0
  const fail = (at: number): never => {
    throw new ScanError(at)
  }
  const ws = (): void => {
    while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++
  }
  const literal = (word: string): void => {
    if (text.slice(i, i + word.length) !== word) fail(i)
    i += word.length
  }
  const string = (): void => {
    if (text[i] !== '"') fail(i)
    i++
    for (;;) {
      if (i >= text.length) fail(i)
      const ch = text[i]
      if (ch === '"') {
        i++
        return
      }
      if (ch === '\\') {
        const esc = text[i + 1]
        if (esc === undefined || !'"\\/bfnrtu'.includes(esc)) fail(i + 1)
        if (esc === 'u') {
          for (let k = 2; k < 6; k++) if (!HEX.test(text[i + k] ?? '')) fail(i + k)
          i += 6
          continue
        }
        i += 2
        continue
      }
      if (ch < ' ') fail(i)
      i++
    }
  }
  const number = (): void => {
    if (text[i] === '-') i++
    if (text[i] === '0') i++
    else if (DIGITS.test(text[i] ?? '')) while (DIGITS.test(text[i] ?? '')) i++
    else fail(i)
    if (text[i] === '.') {
      i++
      if (!DIGITS.test(text[i] ?? '')) fail(i)
      while (DIGITS.test(text[i] ?? '')) i++
    }
    if (text[i] === 'e' || text[i] === 'E') {
      i++
      if (text[i] === '+' || text[i] === '-') i++
      if (!DIGITS.test(text[i] ?? '')) fail(i)
      while (DIGITS.test(text[i] ?? '')) i++
    }
  }
  const value = (): void => {
    ws()
    const ch = text[i]
    if (ch === undefined) fail(i)
    if (ch === '{') return object()
    if (ch === '[') return array()
    if (ch === '"') return string()
    if (ch === 't') return literal('true')
    if (ch === 'f') return literal('false')
    if (ch === 'n') return literal('null')
    if (ch === '-' || DIGITS.test(ch)) return number()
    fail(i)
  }
  const object = (): void => {
    i++
    ws()
    if (text[i] === '}') {
      i++
      return
    }
    for (;;) {
      ws()
      string()
      ws()
      if (text[i] !== ':') fail(i)
      i++
      value()
      ws()
      if (text[i] === ',') {
        i++
        continue
      }
      if (text[i] === '}') {
        i++
        return
      }
      fail(i)
    }
  }
  const array = (): void => {
    i++
    ws()
    if (text[i] === ']') {
      i++
      return
    }
    for (;;) {
      value()
      ws()
      if (text[i] === ',') {
        i++
        continue
      }
      if (text[i] === ']') {
        i++
        return
      }
      fail(i)
    }
  }

  let at: number
  try {
    value()
    ws()
    if (i !== text.length) throw new ScanError(i)
    return null
  } catch (e) {
    if (!(e instanceof ScanError)) throw e
    at = Math.min(e.at, text.length)
  }
  const before = text.slice(0, at)
  const line = before.split('\n').length
  return { position: at, line, column: at - (before.lastIndexOf('\n') + 1) + 1 }
}

/**
 * The parser's own words with its position clause removed — the WHAT of a syntax
 * error, whose WHERE {@link jsonSyntaxPosition} states in one stable form. Left
 * untouched when V8 phrases it some way this does not recognize, because a
 * slightly redundant message beats a mangled one.
 */
function syntaxReason(message: string): string {
  return message
    .replace(/ (?:in JSON )?at position \d+(?: \(line \d+ column \d+\))?$/, '')
    .replace(/, (?:\.\.\.)?"[\s\S]*" is not valid JSON$/, '')
}

/** What sits at a key path, in the words a failure message uses. */
function describeJsonType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  switch (typeof value) {
    case 'string':
      return 'a string'
    case 'number':
      return 'a number'
    case 'boolean':
      return 'a boolean'
    default:
      return 'an object'
  }
}

/** True for a plain JSON object — the only thing a key path may index THROUGH. */
function isJsonObject(value: unknown): value is Record<string, GuardJsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** `"limits"`, or the document root when nothing of the path exists yet. */
function deepestText(segments: readonly string[], depth: number): string {
  return depth === 0 ? 'the document root' : `"${guardKeyPathText(segments.slice(0, depth))}"`
}

/**
 * Walk a key path's INTERMEDIATE containers, returning the object the final key
 * belongs to. Every intermediate must already exist and be an object: a patch never
 * conjures a container, because a scenario that addressed a shape the document does
 * not have is asserting something it was never told.
 */
function containerFor(
  root: Record<string, GuardJsonValue>,
  segments: readonly string[],
  file: string,
  operation: string,
): Record<string, GuardJsonValue> {
  let current = root
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i]
    if (!Object.prototype.hasOwnProperty.call(current, key)) {
      throw new PatchError(
        `patch: ${file} ${operation}: "${guardKeyPathText(segments.slice(0, i + 1))}" does not exist — ` +
          `the deepest key path that exists is ${deepestText(segments, i)} ` +
          '(a patch never creates intermediate containers)',
      )
    }
    const next = current[key]
    if (!isJsonObject(next)) {
      throw new PatchError(
        `patch: ${file} ${operation}: "${guardKeyPathText(segments.slice(0, i + 1))}" is ` +
          `${describeJsonType(next)}, not an object — a key path indexes through objects only`,
      )
    }
    current = next
  }
  return current
}

/** A key path's segments, or the step failing on a path the loader should have caught. */
function segmentsOf(keyPath: string, file: string, operation: string): string[] {
  const parsed = guardKeyPathSegments(keyPath)
  if ('error' in parsed) throw new PatchError(`patch: ${file} ${operation}: ${parsed.error}`)
  return parsed.segments
}

export interface PatchJsonTextParams {
  /** The path as the transcript names it — every message leads with it. */
  file: string
  /** The document's current text. */
  text: string
  /** Key path → value, applied in declaration order. The FINAL key may be new. */
  set?: Record<string, GuardJsonValue>
  /** Key paths to delete, applied after every `set`. Each must exist in full. */
  remove?: readonly string[]
}

/**
 * Apply one file's operations and return the document's new TEXT.
 *
 * Sets run first, in declaration order, then removes — a record and a list cannot
 * interleave, so the order is stated rather than inferred. The result is
 * re-serialized with 2-space indent and a trailing newline: a patch NORMALIZES
 * formatting rather than preserving bytes, which is the honest reading of "edit the
 * document, not the file".
 *
 * Throws {@link PatchError} — never returns a partly-applied document — when the
 * text is not JSON, its root is not an object, an intermediate container is missing
 * or is not an object, or a `remove` names a key path that is not there.
 */
export function patchJsonText(params: PatchJsonTextParams): string {
  const { file, text } = params
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch (e) {
    const reason = syntaxReason(e instanceof Error ? e.message : String(e))
    const where = jsonSyntaxPosition(text)
    throw new PatchError(
      where
        ? `patch: ${file} is not valid JSON at line ${where.line}, column ${where.column} ` +
          `(position ${where.position}) — ${reason}`
        : `patch: ${file} is not valid JSON — ${reason}`,
    )
  }
  if (!isJsonObject(doc)) {
    throw new PatchError(
      `patch: ${file} is ${describeJsonType(doc)}, not an object — a key path addresses object keys`,
    )
  }

  for (const [keyPath, value] of Object.entries(params.set ?? {})) {
    const operation = `set ${keyPath}`
    const segments = segmentsOf(keyPath, file, operation)
    const container = containerFor(doc, segments, file, operation)
    // The FINAL key may be new — setting a field the document does not carry yet is
    // what the step is FOR. Only the containers above it must already be there.
    // Defined rather than assigned so EVERY key lands as an own property: plain
    // assignment to `__proto__` moves a prototype and writes no field, which is the
    // one way this step could silently not do what it says.
    Object.defineProperty(container, segments[segments.length - 1], {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    })
  }

  for (const keyPath of params.remove ?? []) {
    const operation = `remove ${keyPath}`
    const segments = segmentsOf(keyPath, file, operation)
    const container = containerFor(doc, segments, file, operation)
    const last = segments[segments.length - 1]
    if (!Object.prototype.hasOwnProperty.call(container, last)) {
      throw new PatchError(
        `patch: ${file} ${operation}: "${guardKeyPathText(segments)}" does not exist — ` +
          `the deepest key path that exists is ${deepestText(segments, segments.length - 1)}`,
      )
    }
    delete container[last]
  }

  return `${JSON.stringify(doc, null, 2)}\n`
}

/**
 * A `set` value with its tokens resolved — every STRING it carries, however deeply
 * nested, run through the scenario's substitution.
 *
 * Strings only: object KEYS and the key path itself are structure a scenario writes
 * literally, so a `${supplied:…}` there would be addressing a field whose name the
 * test does not know. Values are where run-time facts belong.
 */
export function resolvePatchValue(value: GuardJsonValue, tok: (text: string) => string): GuardJsonValue {
  if (typeof value === 'string') return tok(value)
  if (Array.isArray(value)) return value.map((item) => resolvePatchValue(item, tok))
  if (isJsonObject(value)) {
    const out: Record<string, GuardJsonValue> = {}
    for (const [key, item] of Object.entries(value)) out[key] = resolvePatchValue(item, tok)
    return out
  }
  return value
}
