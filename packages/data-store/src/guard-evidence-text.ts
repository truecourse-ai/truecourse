/**
 * Guard transcript text is serialized JSON in the content pool. A tagged
 * manifest reference distinguishes it from legacy plain text without guessing
 * from the body. The stored JSON preserves NUL and lone UTF-16 surrogates.
 * Visual evidence still references base64 bytes by its untagged content hash.
 */
import { ContentStore } from './content-store.js';

const PREFIX = 'json-v1:';

/** The underlying content hash, also used by retention's reachability sweep. */
export function guardEvidenceContentSha(reference: string): string {
  return reference.startsWith(PREFIX) ? reference.slice(PREFIX.length) : reference;
}

export async function putGuardEvidenceText(content: ContentStore, scope: string, text: string): Promise<string> {
  return PREFIX + await content.putText(scope, JSON.stringify(text));
}

export async function readGuardEvidenceText(content: ContentStore, scope: string, reference: string): Promise<string | null> {
  const body = await content.get(scope, guardEvidenceContentSha(reference));
  if (body === null || !reference.startsWith(PREFIX)) return body;
  try {
    const text: unknown = JSON.parse(body);
    if (typeof text !== 'string') throw new Error();
    return text;
  } catch {
    throw new Error('Invalid stored guard evidence text');
  }
}
