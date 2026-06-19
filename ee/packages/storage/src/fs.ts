/** Filesystem BlobStore — blobs as files under a root dir. */

import { promises as fsp } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { BlobStore } from './types.js';

export class FsBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  /** Map an opaque key to a safe path under root (no traversal / absolute). */
  private file(key: string): string {
    const safe = key
      .split('/')
      .filter((seg) => seg && seg !== '.' && seg !== '..')
      .join('/');
    return path.join(this.root, safe);
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const f = this.file(key);
    await fsp.mkdir(path.dirname(f), { recursive: true });
    await fsp.writeFile(f, bytes);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await fsp.readFile(this.file(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fsp.unlink(this.file(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(this.file(key));
  }

  async list(prefix: string): Promise<string[]> {
    // Keys are stored as nested paths; a key's identity is its root-relative
    // posix path. Walk the subtree the prefix maps to and reconstruct keys.
    const norm = prefix
      .split('/')
      .filter((seg) => seg && seg !== '.' && seg !== '..')
      .join('/');
    const baseDir = path.join(this.root, norm);
    const out: string[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw err;
      }
      for (const e of entries) {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(path.join(dir, e.name), childRel);
        else if (e.isFile()) out.push(norm ? `${norm}/${childRel}` : childRel);
      }
    };
    await walk(baseDir, '');
    return out.filter((k) => k.startsWith(prefix));
  }
}
