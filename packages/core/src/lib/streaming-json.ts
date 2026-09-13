/**
 * Streaming JSON read/write for very large store documents.
 *
 * `JSON.stringify` / `JSON.parse` both materialize the whole document as a
 * single JavaScript string, and V8 caps any string at ~512 MB
 * (`buffer.constants.MAX_STRING_LENGTH`, 536,870,888 chars on 64-bit). A large
 * analysis result — 100k+ violations across thousands of files, plus the graph
 * — serializes past that ceiling, so `JSON.stringify` throws
 * `RangeError: Invalid string length` before a byte is written (and a file that
 * large could not be read back with `JSON.parse(readFileSync(...))` either).
 *
 * The functions here never hold the whole document as one string:
 *  - {@link writeJsonStreaming} walks the value and streams it to disk, so the
 *    largest string ever allocated is one leaf value.
 *  - {@link readJsonStreaming} parses the file as a byte stream and assembles
 *    the object without concatenating the file into a single string.
 *
 * The in-memory object tree itself is unaffected by the string limit — only the
 * serialized/parsed *string* is. That is the whole point of streaming here.
 */

import { createReadStream, createWriteStream } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import streamJson from 'stream-json';
import Assembler from 'stream-json/Assembler.js';

const { parser } = streamJson;

// Flush the pending buffer to the write stream once it reaches this size. Keeps
// the in-flight string tiny relative to V8's ~512 MB single-string ceiling, so
// the buffer never itself becomes an "Invalid string length".
const FLUSH_THRESHOLD = 1 << 20; // 1 MiB

// Monotonic counter so two writes to the same target within the same
// millisecond still get distinct temp filenames (pid + time can collide).
let tmpCounter = 0;

/** A value JSON.stringify omits (object property) or renders as `null` (array element). */
function isOmitted(value: unknown): boolean {
  return value === undefined || typeof value === 'function' || typeof value === 'symbol';
}

/** Apply a `toJSON()` hook the same way `JSON.stringify` does before serializing. */
function applyToJSON(value: unknown): unknown {
  if (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { toJSON?: unknown }).toJSON === 'function'
  ) {
    return (value as { toJSON: () => unknown }).toJSON();
  }
  return value;
}

/**
 * Serialize `data` to `targetPath` as pretty-printed JSON — byte-identical to
 * `JSON.stringify(data, null, 2)` — without ever materializing the whole
 * document as a single string.
 *
 * Atomic like `atomicWriteJson`: streams into a temp file on the same
 * directory, then `rename`s over the target so readers see all-or-nothing. On
 * any error the temp file is removed and the original target is left untouched.
 *
 * Scalar escaping/formatting is delegated to `JSON.stringify` per leaf value,
 * so unicode, string escapes, number formatting, and `bigint` rejection match
 * the platform exactly; only structural characters and indentation are emitted
 * here. `data` is expected to be a JSON value (object/array/scalar/null), as
 * every store document is.
 */
export async function writeJsonStreaming(targetPath: string, data: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.tmp-${process.pid}-${Date.now()}-${tmpCounter++}`;
  const stream = createWriteStream(tmp, { encoding: 'utf8' });

  // Single persistent error latch. `rejectPending` lets a stream error abort an
  // in-progress backpressure/end wait without attaching a fresh 'error'
  // listener per wait (which would leak listeners on a large document).
  let streamError: Error | null = null;
  let rejectPending: ((err: Error) => void) | null = null;
  stream.on('error', (err: Error) => {
    streamError = err;
    if (rejectPending) rejectPending(err);
  });

  let buffer = '';

  const flush = async (): Promise<void> => {
    if (streamError) throw streamError;
    if (buffer.length === 0) return;
    const chunk = buffer;
    buffer = '';
    if (!stream.write(chunk)) {
      await new Promise<void>((resolve, reject) => {
        rejectPending = reject;
        stream.once('drain', () => {
          rejectPending = null;
          resolve();
        });
      });
    }
  };

  const push = async (text: string): Promise<void> => {
    buffer += text;
    if (buffer.length >= FLUSH_THRESHOLD) await flush();
  };

  const serialize = async (value: unknown, indent: string): Promise<void> => {
    const v = applyToJSON(value);

    if (v === null || typeof v !== 'object') {
      // Scalar (string/number/boolean/bigint) or null — let V8 format it.
      // `bigint` throws here, exactly as `JSON.stringify` would. A top-level
      // omitted value (undefined/function/symbol) has no JSON form; emit `null`
      // to keep the file valid — the store never writes such a top-level value.
      const scalar = JSON.stringify(v);
      await push(scalar === undefined ? 'null' : scalar);
      return;
    }

    const childIndent = indent + '  ';

    if (Array.isArray(v)) {
      if (v.length === 0) {
        await push('[]');
        return;
      }
      await push('[\n');
      for (let i = 0; i < v.length; i++) {
        await push(childIndent);
        const element = applyToJSON(v[i]);
        if (isOmitted(element)) await push('null');
        else await serialize(element, childIndent);
        await push(i === v.length - 1 ? '\n' : ',\n');
      }
      await push(`${indent}]`);
      return;
    }

    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).filter((key) => !isOmitted(applyToJSON(obj[key])));
    if (keys.length === 0) {
      await push('{}');
      return;
    }
    await push('{\n');
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      await push(`${childIndent}${JSON.stringify(key)}: `);
      await serialize(obj[key], childIndent);
      await push(i === keys.length - 1 ? '\n' : ',\n');
    }
    await push(`${indent}}`);
  };

  try {
    await serialize(data, '');
    await flush();
    await new Promise<void>((resolve, reject) => {
      rejectPending = reject;
      stream.end(() => {
        rejectPending = null;
        resolve();
      });
    });
    if (streamError) throw streamError;
  } catch (err) {
    stream.destroy();
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }

  await fsp.rename(tmp, targetPath);
}

/**
 * Parse the JSON file at `file` without ever holding it as a single string.
 *
 * Streams the file through a token parser and assembles the value
 * incrementally, so a document larger than V8's max string length still loads
 * (the resulting in-memory object is unaffected by that limit). Rejects on a
 * read or parse error, mirroring `JSON.parse` throwing on malformed input.
 */
export async function readJsonStreaming<T>(file: string): Promise<T> {
  const source = createReadStream(file);
  const tokens = source.pipe(parser());
  const assembler = Assembler.connectTo(tokens);

  // Read and parse errors surface on the file stream (`source`) and the token
  // parser (`tokens`); the assembler only reconstructs values from tokens the
  // parser already validated, so those two cover every failure path.
  await new Promise<void>((resolve, reject) => {
    tokens.on('end', resolve);
    tokens.on('error', reject);
    source.on('error', reject);
  });

  return assembler.current as T;
}
