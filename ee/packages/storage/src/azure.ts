/**
 * Azure Blob Storage BlobStore (native — not S3-via-gateway). Uses managed
 * identity (`DefaultAzureCredential`) by default so an Azure-hosted deploy needs
 * no stored account keys; a connection string is also supported.
 */

import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import type { BlobStore, AzureBlobConfig } from './types.js';

function isNotFound(err: unknown): boolean {
  const e = err as { statusCode?: number; code?: string };
  return e?.statusCode === 404 || e?.code === 'BlobNotFound';
}

export class AzureBlobStore implements BlobStore {
  private readonly container: ContainerClient;

  constructor(cfg: AzureBlobConfig) {
    const service = cfg.connectionString
      ? BlobServiceClient.fromConnectionString(cfg.connectionString)
      : new BlobServiceClient(
          `https://${cfg.account}.blob.core.windows.net`,
          new DefaultAzureCredential(),
        );
    this.container = service.getContainerClient(cfg.container);
  }

  async put(key: string, bytes: Buffer, opts?: { contentType?: string }): Promise<void> {
    const blob = this.container.getBlockBlobClient(key);
    await blob.uploadData(bytes, {
      blobHTTPHeaders: opts?.contentType ? { blobContentType: opts.contentType } : undefined,
    });
  }

  async get(key: string): Promise<Buffer | null> {
    const blob = this.container.getBlockBlobClient(key);
    try {
      return await blob.downloadToBuffer();
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.container.getBlockBlobClient(key).deleteIfExists();
  }

  async exists(key: string): Promise<boolean> {
    return this.container.getBlockBlobClient(key).exists();
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    for await (const blob of this.container.listBlobsFlat({ prefix })) {
      out.push(blob.name);
    }
    return out;
  }
}
