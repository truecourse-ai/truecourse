/**
 * File-based GateStore — the default for local/dev. Keeps TrueCourse's
 * file-only storage model intact: JSON under `~/.truecourse/github-app/`
 * (honoring TRUECOURSE_HOME), written atomically (temp + rename).
 *
 * Read-modify-write per call with last-write-wins. Adequate for single-node
 * local use; the hosted multi-tenant deployment uses the Postgres adapter.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getGlobalDir } from '@truecourse/core/config/paths';
import type {
  GateStore,
  InstallationRecord,
  RepoLinkRecord,
  BaselineRecord,
  GateRunRecord,
} from './types.js';

function atomicWriteJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

export class FileGateStore implements GateStore {
  private readonly dir: string;

  constructor(baseDir?: string) {
    this.dir = baseDir ?? path.join(getGlobalDir(), 'github-app');
  }

  private file(name: string): string {
    return path.join(this.dir, name);
  }

  // --- installations (keyed by installationId) ---

  private readInstallations(): Record<string, InstallationRecord> {
    return readJson(this.file('installations.json'), {});
  }

  async saveInstallation(rec: InstallationRecord): Promise<void> {
    const all = this.readInstallations();
    const prev = all[String(rec.installationId)];
    // Merge, mirroring the Postgres adapter: a re-sent install event without a
    // workspace must not wipe an existing link, and createdAt is preserved.
    all[String(rec.installationId)] = {
      ...rec,
      workspaceOrgId: rec.workspaceOrgId ?? prev?.workspaceOrgId ?? null,
      createdAt: prev?.createdAt ?? rec.createdAt,
    };
    atomicWriteJson(this.file('installations.json'), all);
  }

  async getInstallation(
    installationId: number,
  ): Promise<InstallationRecord | null> {
    return this.readInstallations()[String(installationId)] ?? null;
  }

  async removeInstallation(installationId: number): Promise<void> {
    const all = this.readInstallations();
    delete all[String(installationId)];
    atomicWriteJson(this.file('installations.json'), all);

    // Cascade: drop repos that belonged to this installation, along with their
    // baselines and run history (all keyed by repoFullName).
    const repos = this.readRepos();
    const removed: string[] = [];
    for (const [key, repo] of Object.entries(repos)) {
      if (repo.installationId === installationId) {
        removed.push(repo.repoFullName);
        delete repos[key];
      }
    }
    if (removed.length === 0) return;
    atomicWriteJson(this.file('repos.json'), repos);

    const baselines = this.readBaselines();
    const runs = this.readRuns();
    for (const name of removed) {
      delete baselines[name];
      delete runs[name];
    }
    atomicWriteJson(this.file('baselines.json'), baselines);
    atomicWriteJson(this.file('runs.json'), runs);
  }

  async linkInstallationToWorkspace(
    installationId: number,
    workspaceOrgId: string,
  ): Promise<void> {
    const all = this.readInstallations();
    const rec = all[String(installationId)];
    if (!rec) return;
    rec.workspaceOrgId = workspaceOrgId;
    rec.updatedAt = new Date().toISOString();
    atomicWriteJson(this.file('installations.json'), all);
  }

  async listInstallationsForWorkspace(
    workspaceOrgId: string,
  ): Promise<InstallationRecord[]> {
    return Object.values(this.readInstallations()).filter(
      (i) => i.workspaceOrgId === workspaceOrgId,
    );
  }

  // --- repo links (keyed by repoFullName) ---

  private readRepos(): Record<string, RepoLinkRecord> {
    return readJson(this.file('repos.json'), {});
  }

  async linkRepo(rec: RepoLinkRecord): Promise<void> {
    const all = this.readRepos();
    all[rec.repoFullName] = rec;
    atomicWriteJson(this.file('repos.json'), all);
  }

  async unlinkRepo(repoFullName: string): Promise<void> {
    const all = this.readRepos();
    delete all[repoFullName];
    atomicWriteJson(this.file('repos.json'), all);
  }

  async getRepo(repoFullName: string): Promise<RepoLinkRecord | null> {
    return this.readRepos()[repoFullName] ?? null;
  }

  async listReposForWorkspace(
    workspaceOrgId: string,
  ): Promise<RepoLinkRecord[]> {
    return Object.values(this.readRepos())
      .filter((r) => r.workspaceOrgId === workspaceOrgId)
      .sort((a, b) => a.repoFullName.localeCompare(b.repoFullName));
  }

  // --- baselines (keyed by repoFullName) ---

  private readBaselines(): Record<string, BaselineRecord> {
    return readJson(this.file('baselines.json'), {});
  }

  async saveBaseline(rec: BaselineRecord): Promise<void> {
    const all = this.readBaselines();
    all[rec.repoFullName] = rec;
    atomicWriteJson(this.file('baselines.json'), all);
  }

  async getBaseline(repoFullName: string): Promise<BaselineRecord | null> {
    return this.readBaselines()[repoFullName] ?? null;
  }

  // --- runs (keyed by repoFullName → array, most-recent-first) ---

  private readRuns(): Record<string, GateRunRecord[]> {
    return readJson(this.file('runs.json'), {});
  }

  async recordRun(rec: GateRunRecord): Promise<void> {
    const all = this.readRuns();
    const list = all[rec.repoFullName] ?? [];
    list.unshift(rec);
    all[rec.repoFullName] = list.slice(0, 200);
    atomicWriteJson(this.file('runs.json'), all);
  }

  async listRuns(repoFullName: string, limit = 50): Promise<GateRunRecord[]> {
    return (this.readRuns()[repoFullName] ?? []).slice(0, limit);
  }
}
