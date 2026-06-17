/**
 * Cloud-agnostic blob storage for the enterprise edition's bulky artifacts
 * (contract corpora, spec/analysis snapshots, caches). One interface, four
 * adapters (Azure native, S3-compatible, Postgres bytea, filesystem), selected
 * by config. Keys are opaque, content-addressed / repo-scoped strings.
 */

export interface BlobStore {
  put(key: string, bytes: Buffer, opts?: { contentType?: string }): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /**
   * Every key that starts with `prefix`. Used only by garbage collection (the
   * mark-sweep over content-addressed objects); the put/get/delete hot paths
   * never call it.
   */
  list(prefix: string): Promise<string[]>;
}

export type BlobStoreKind = 'azure' | 's3' | 'postgres' | 'fs';

/** Azure Blob Storage (native). Managed identity when no connection string. */
export interface AzureBlobConfig {
  kind: 'azure';
  /** Storage account name (used with managed identity). */
  account?: string;
  container: string;
  /** Optional connection string (skips managed identity). */
  connectionString?: string;
}

/** Any S3-compatible store (AWS S3, MinIO, R2, …) via a configurable endpoint. */
export interface S3BlobConfig {
  kind: 's3';
  /** Custom endpoint (MinIO / R2 / on-prem); omit for AWS S3. */
  endpoint?: string;
  region?: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Path-style addressing — defaulted on for custom endpoints (MinIO needs it). */
  forcePathStyle?: boolean;
}

/** Postgres `bytea` — the minimal, object-store-free deploy. */
export interface PostgresBlobConfig {
  kind: 'postgres';
}

/** Local filesystem — OSS/dev and single-host deploys. */
export interface FsBlobConfig {
  kind: 'fs';
  root: string;
}

export type BlobStoreConfig =
  | AzureBlobConfig
  | S3BlobConfig
  | PostgresBlobConfig
  | FsBlobConfig;
