/**
 * JSON ⇄ blob helpers. Snapshots are stored as UTF-8 JSON in the BlobStore;
 * `null` (missing key) round-trips to `null`.
 */

import type { BlobStore } from '@truecourse/ee-storage';

export async function putJson(blob: BlobStore, key: string, value: unknown): Promise<void> {
  await blob.put(key, Buffer.from(JSON.stringify(value), 'utf-8'), {
    contentType: 'application/json',
  });
}

export async function getJson<T>(blob: BlobStore, key: string): Promise<T | null> {
  const bytes = await blob.get(key);
  if (!bytes) return null;
  return JSON.parse(bytes.toString('utf-8')) as T;
}
