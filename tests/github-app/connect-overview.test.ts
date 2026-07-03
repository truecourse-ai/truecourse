/**
 * The connect `/status` repo overview reads the corpus + contracts at the
 * BASELINE commit (the default-branch view), never the newest scan — a PR-head
 * scan (saved at the PR head sha) must not leak its overlap count or contracts
 * into the repo overview.
 */
import express, { type Express, type Request } from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import type { AuthUser, GithubConnectStatusResponse } from '@truecourse/shared';
import {
  createConnectRouter,
  FileGateStore,
} from '../../ee/packages/github-app/src/index';
import type { OctokitClient } from '../../ee/packages/github-app/src/octokit';
import { PgSpecStore, PgContractStore } from '../../ee/packages/data-store/src/index';
import { setSpecStore, resetSpecStore, saveSpec } from '@truecourse/core/lib/spec-store';
import { setContractStore, resetContractStore, saveContracts } from '@truecourse/core/lib/contract-store';
import { setRegistryStore, resetRegistryStore, type RegistryStore } from '@truecourse/core/config/registry';

const REPO = 'acme/api';
const stubOctokit = { paginate: async () => [] } as unknown as OctokitClient;
const stubRegistry: RegistryStore = {
  readRegistry: async () => [],
  pruneStaleProjects: async () => [],
  getProjectBySlug: async () => null,
  getProjectByPath: async () => null,
  registerProject: async (p, name) => ({ slug: 'stub', name: name ?? p, path: p }),
  unregisterProject: async () => false,
  touchProject: async () => {},
  setLastAnalyzed: async () => {},
};

let client: PGlite;
let gateDir: string;
let contractsDir: string;
let store: FileGateStore;
let app: Express;

beforeEach(async () => {
  client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  setSpecStore(new PgSpecStore(db as unknown as EeDb));
  setContractStore(new PgContractStore(db as unknown as EeDb));
  setRegistryStore(stubRegistry);

  gateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-overview-gate-'));
  store = new FileGateStore(gateDir);
  contractsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-overview-tc-'));
  fs.writeFileSync(path.join(contractsDir, 'auth.tc'), 'auth requirement');

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Request & { eeUser?: AuthUser }).eeUser = {
      id: 'u1', email: 'u@acme.test', organizationId: 'org_A',
    };
    next();
  });
  app.use('/api/ee/github', createConnectRouter({
    store, appSlug: 'tc-gate', appUrl: 'http://localhost:3000', octokitFor: () => stubOctokit,
  }));
});

afterEach(async () => {
  resetSpecStore();
  resetContractStore();
  resetRegistryStore();
  await client.close();
  for (const d of [gateDir, contractsDir]) fs.rmSync(d, { recursive: true, force: true });
});

async function connectRepo() {
  await store.saveInstallation({
    installationId: 100, accountLogin: 'acme', accountType: 'Organization',
    workspaceOrgId: 'org_A', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
  await store.linkRepo({
    repoFullName: REPO, installationId: 100, workspaceOrgId: 'org_A', defaultBranch: 'main',
    blocking: true, enabled: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

describe('connect overview reads the baseline corpus', () => {
  it('reflects the baseline commit and ignores a newer PR-head scan', async () => {
    await connectRepo();
    await store.saveBaseline({
      repoFullName: REPO, commitSha: 'base1', drifts: [], capturedAt: '2026-01-02T00:00:00.000Z',
    });
    // Baseline corpus: 1 flagged overlap. Contracts stored at the baseline commit.
    await saveSpec({ repoKey: REPO, commitSha: 'base1' }, 'corpus', {
      areas: [{ overlaps: [{ id: 'x' }] }, { overlaps: [] }],
    });
    await saveContracts({ repoKey: REPO, commitSha: 'base1' }, 'contracts', contractsDir);
    // A NEWER PR-head scan with 3 overlaps and no contracts — must NOT leak in.
    await saveSpec({ repoKey: REPO, commitSha: 'prhead' }, 'corpus', {
      areas: [{ overlaps: [1, 2, 3] }],
    });

    const res = await request(app).get('/api/ee/github/status').expect(200);
    const body = res.body as GithubConnectStatusResponse;
    expect(body.repos).toHaveLength(1);
    expect(body.repos[0]!.openConflicts).toBe(1); // baseline's overlap count, not 3
    expect(body.repos[0]!.hasContracts).toBe(true); // baseline commit has contracts
  });

  it('is a clean zero-state for a connected repo with no baseline yet', async () => {
    await connectRepo();
    const res = await request(app).get('/api/ee/github/status').expect(200);
    const body = res.body as GithubConnectStatusResponse;
    expect(body.repos[0]!.openConflicts).toBe(0);
    expect(body.repos[0]!.hasContracts).toBe(false);
  });
});
