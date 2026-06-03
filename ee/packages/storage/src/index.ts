/**
 * Cloud-agnostic blob storage. `selectBlobStore` picks the adapter by config;
 * `loadBlobStoreConfig` reads it from the environment. Azure is the first-class
 * default target (managed identity); S3 covers AWS/MinIO/on-prem; Postgres and
 * fs are the minimal/dev options.
 */

import type { EeDb } from '@truecourse/ee-db';
import type { BlobStore, BlobStoreConfig } from './types.js';
import { FsBlobStore } from './fs.js';
import { PostgresBlobStore } from './postgres.js';
import { S3BlobStore } from './s3.js';
import { AzureBlobStore } from './azure.js';

export * from './types.js';
export { FsBlobStore } from './fs.js';
export { PostgresBlobStore } from './postgres.js';
export { S3BlobStore } from './s3.js';
export { AzureBlobStore } from './azure.js';

/**
 * Build a BlobStore from config. The `postgres` adapter needs the shared ee-db.
 */
export function selectBlobStore(config: BlobStoreConfig, db?: EeDb | null): BlobStore {
  switch (config.kind) {
    case 'azure':
      return new AzureBlobStore(config);
    case 's3':
      return new S3BlobStore(config);
    case 'postgres':
      if (!db) {
        throw new Error('[ee-storage] BLOB_STORE=postgres requires DATABASE_URL (the shared ee-db)');
      }
      return new PostgresBlobStore(db);
    case 'fs':
      return new FsBlobStore(config.root);
  }
}

/** Resolve the blob-store config from env. Defaults to `postgres`. */
export function loadBlobStoreConfig(): BlobStoreConfig {
  const kind = process.env.BLOB_STORE ?? 'postgres';
  switch (kind) {
    case 'azure':
      return {
        kind: 'azure',
        account: process.env.AZURE_STORAGE_ACCOUNT,
        container: process.env.AZURE_STORAGE_CONTAINER ?? 'truecourse',
        connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
      };
    case 's3':
      return {
        kind: 's3',
        endpoint: process.env.S3_ENDPOINT,
        region: process.env.S3_REGION,
        bucket: process.env.S3_BUCKET ?? 'truecourse',
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      };
    case 'fs':
      return { kind: 'fs', root: process.env.BLOB_FS_ROOT ?? '/var/lib/truecourse/blobs' };
    case 'postgres':
    default:
      return { kind: 'postgres' };
  }
}
