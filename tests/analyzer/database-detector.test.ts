import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { detectDatabases, parseDockerCompose } from '../../packages/analyzer/src/database-detector';
import { discoverFiles } from '../../packages/analyzer/src/file-discovery';
import { detectServices } from '../../packages/analyzer/src/service-detector';
import type { FileAnalysis } from '@truecourse/shared';

const FIXTURE_PATH = new URL('../fixtures/sample-project', import.meta.url).pathname;

describe('parseDockerCompose', () => {
  it('detects postgres and redis from the fixture docker-compose.yml', () => {
    const results = parseDockerCompose(FIXTURE_PATH);
    expect(results).toHaveLength(2);

    const postgres = results.find((r) => r.type === 'postgres');
    expect(postgres).toBeDefined();
    expect(postgres!.name).toBe('postgres');

    const redis = results.find((r) => r.type === 'redis');
    expect(redis).toBeDefined();
    expect(redis!.name).toBe('redis');
  });

  it('returns empty array when no docker-compose file exists', () => {
    const results = parseDockerCompose('/nonexistent/path');
    expect(results).toEqual([]);
  });

  it('parses docker-compose with various database images', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'truecourse-docker-test-'));

    writeFileSync(
      join(tempDir, 'docker-compose.yml'),
      `services:
  db:
    image: postgres:15
  cache:
    image: redis:7
  nosql:
    image: mongo:6
  sql:
    image: mysql:8
`
    );

    const results = parseDockerCompose(tempDir);
    expect(results).toHaveLength(4);
    expect(results.map((r) => r.type).sort()).toEqual(['mongodb', 'mysql', 'postgres', 'redis']);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('handles docker-compose with non-database services', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'truecourse-docker-test-'));

    writeFileSync(
      join(tempDir, 'docker-compose.yml'),
      `services:
  app:
    image: node:18
  nginx:
    image: nginx:latest
  db:
    image: postgres:15
`
    );

    const results = parseDockerCompose(tempDir);
    // Only postgres should be detected, not node or nginx
    expect(results).toHaveLength(1);
    expect(results[0]!.type).toBe('postgres');
    expect(results[0]!.name).toBe('db');

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('supports compose.yml filename variant', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'truecourse-docker-test-'));

    writeFileSync(
      join(tempDir, 'compose.yml'),
      `services:
  redis:
    image: redis:7-alpine
`
    );

    const results = parseDockerCompose(tempDir);
    expect(results).toHaveLength(1);
    expect(results[0]!.type).toBe('redis');

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects mariadb as mysql type', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'truecourse-docker-test-'));

    writeFileSync(
      join(tempDir, 'docker-compose.yml'),
      `services:
  mariadb:
    image: mariadb:10
`
    );

    const results = parseDockerCompose(tempDir);
    expect(results).toHaveLength(1);
    expect(results[0]!.type).toBe('mysql');

    rmSync(tempDir, { recursive: true, force: true });
  });
});

describe('detectDatabases with fixture project', () => {
  // Set up services from the fixture project
  const fixtureFiles = discoverFiles(FIXTURE_PATH);
  const services = detectServices(FIXTURE_PATH, fixtureFiles);

  // Build FileAnalysis objects manually with correct paths matching the services
  // This ensures the import scanning correctly associates imports with services.
  const userServiceFiles = services.find((s) => s.name === 'user-service')?.files || [];
  const apiGatewayFiles = services.find((s) => s.name === 'api-gateway')?.files || [];

  // The connection.ts file imports @prisma/client
  const connectionFile = userServiceFiles.find((f) => f.includes('connection.ts'));
  // The redis.ts file imports ioredis
  const redisFile = apiGatewayFiles.find((f) => f.includes('redis.ts'));

  function makeAnalysis(filePath: string, importSources: string[]): FileAnalysis {
    return {
      filePath,
      language: 'typescript',
      functions: [],
      classes: [],
      imports: importSources.map((source) => ({
        source,
        specifiers: [{ name: 'default', isDefault: true, isNamespace: false }],
        isTypeOnly: false,
      })),
      exports: [],
      calls: [],
      httpCalls: [],
    };
  }

  // Build analyses that mirror the actual fixture files
  const analyses: FileAnalysis[] = [];
  if (connectionFile) {
    analyses.push(makeAnalysis(connectionFile, ['@prisma/client']));
  }
  if (redisFile) {
    analyses.push(makeAnalysis(redisFile, ['ioredis']));
  }

  it('detects postgres database from @prisma/client import', () => {
    const result = detectDatabases(FIXTURE_PATH, analyses, services);
    const postgresDb = result.databases.find((db) => db.type === 'postgres');
    expect(postgresDb).toBeDefined();
    expect(postgresDb!.driver).toBe('prisma');
  });

  it('detects redis database from ioredis import', () => {
    const result = detectDatabases(FIXTURE_PATH, analyses, services);
    const redisDb = result.databases.find((db) => db.type === 'redis');
    expect(redisDb).toBeDefined();
    expect(redisDb!.driver).toBe('ioredis');
  });

  it('parses Prisma schema and includes tables in postgres database', () => {
    const result = detectDatabases(FIXTURE_PATH, analyses, services);
    const postgresDb = result.databases.find((db) => db.type === 'postgres');
    expect(postgresDb).toBeDefined();
    expect(postgresDb!.tables.length).toBeGreaterThanOrEqual(2);

    const tableNames = postgresDb!.tables.map((t) => t.name);
    expect(tableNames).toContain('User');
    expect(tableNames).toContain('Post');
  });

  it('includes relations from Prisma schema', () => {
    const result = detectDatabases(FIXTURE_PATH, analyses, services);
    const postgresDb = result.databases.find((db) => db.type === 'postgres');
    expect(postgresDb).toBeDefined();
    expect(postgresDb!.relations.length).toBeGreaterThanOrEqual(1);

    const postToUser = postgresDb!.relations.find(
      (r) => r.sourceTable === 'Post' && r.targetTable === 'User'
    );
    expect(postToUser).toBeDefined();
    expect(postToUser!.foreignKeyColumn).toBe('authorId');
  });

  it('creates connections linking services to databases', () => {
    const result = detectDatabases(FIXTURE_PATH, analyses, services);
    expect(result.connections.length).toBeGreaterThan(0);

    // user-service connects to postgres via prisma
    const prismaConn = result.connections.find(
      (c) => c.databaseName === 'postgres' && c.driver === 'prisma'
    );
    expect(prismaConn).toBeDefined();
    expect(prismaConn!.serviceName).toBe('user-service');

    // api-gateway connects to redis via ioredis
    const redisConn = result.connections.find((c) => c.driver === 'ioredis');
    expect(redisConn).toBeDefined();
    expect(redisConn!.serviceName).toBe('api-gateway');
  });

  it('uses Docker Compose service names for database names when available', () => {
    const result = detectDatabases(FIXTURE_PATH, analyses, services);

    // The docker-compose.yml defines services named 'postgres' and 'redis'
    const dbNames = result.databases.map((db) => db.name);
    expect(dbNames).toContain('postgres');
    expect(dbNames).toContain('redis');
  });

  it('deduplicates databases by type', () => {
    const result = detectDatabases(FIXTURE_PATH, analyses, services);

    // Should not have duplicate postgres entries even though
    // both import scanning and Docker Compose detect it
    const postgresDbs = result.databases.filter((db) => db.type === 'postgres');
    expect(postgresDbs).toHaveLength(1);

    const redisDbs = result.databases.filter((db) => db.type === 'redis');
    expect(redisDbs).toHaveLength(1);
  });

  it('lists connected services for each database', () => {
    const result = detectDatabases(FIXTURE_PATH, analyses, services);

    const postgresDb = result.databases.find((db) => db.type === 'postgres');
    expect(postgresDb).toBeDefined();
    expect(postgresDb!.connectedServices).toContain('user-service');

    const redisDb = result.databases.find((db) => db.type === 'redis');
    expect(redisDb).toBeDefined();
    expect(redisDb!.connectedServices).toContain('api-gateway');
  });
});

describe('detectDatabases with no databases', () => {
  let tempDir: string;

  afterAll(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns empty result when no databases are detected', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'truecourse-nodb-test-'));

    const srcDir = join(tempDir, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'no-db-app', version: '1.0.0' })
    );
    writeFileSync(join(srcDir, 'index.ts'), 'console.log("hello");');

    const files = [join(srcDir, 'index.ts')];
    const services = detectServices(tempDir, files);

    const fakeAnalysis: FileAnalysis = {
      filePath: join(srcDir, 'index.ts'),
      language: 'typescript',
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      calls: [],
      httpCalls: [],
    };

    const result = detectDatabases(tempDir, [fakeAnalysis], services);
    expect(result.databases).toHaveLength(0);
    expect(result.connections).toHaveLength(0);
  });
});

describe('detectDatabases import scanning', () => {
  let tempDir: string;

  afterAll(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('detects databases from import sources in FileAnalysis', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'truecourse-import-test-'));

    const srcDir = join(tempDir, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'import-test', version: '1.0.0' })
    );
    writeFileSync(join(srcDir, 'index.ts'), 'import mongoose from "mongoose";');

    const filePath = join(srcDir, 'index.ts');
    const files = [filePath];
    const services = detectServices(tempDir, files);

    const fakeAnalysis: FileAnalysis = {
      filePath,
      language: 'typescript',
      functions: [],
      classes: [],
      imports: [
        { source: 'mongoose', specifiers: [{ name: 'mongoose', isDefault: true, isNamespace: false }], isTypeOnly: false },
      ],
      exports: [],
      calls: [],
      httpCalls: [],
    };

    const result = detectDatabases(tempDir, [fakeAnalysis], services);
    const mongoDb = result.databases.find((db) => db.type === 'mongodb');
    expect(mongoDb).toBeDefined();
    expect(mongoDb!.driver).toBe('mongoose');
  });

  it('detects multiple database types from different imports', () => {
    const tempDir2 = mkdtempSync(join(tmpdir(), 'truecourse-multi-import-'));

    const srcDir = join(tempDir2, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(tempDir2, 'package.json'),
      JSON.stringify({ name: 'multi-db', version: '1.0.0' })
    );
    writeFileSync(join(srcDir, 'app.ts'), '');

    const filePath = join(srcDir, 'app.ts');
    const files = [filePath];
    const services = detectServices(tempDir2, files);

    const fakeAnalysis: FileAnalysis = {
      filePath,
      language: 'typescript',
      functions: [],
      classes: [],
      imports: [
        { source: 'pg', specifiers: [{ name: 'Pool', isDefault: false, isNamespace: false }], isTypeOnly: false },
        { source: 'ioredis', specifiers: [{ name: 'Redis', isDefault: true, isNamespace: false }], isTypeOnly: false },
        { source: 'mongoose', specifiers: [{ name: 'mongoose', isDefault: true, isNamespace: false }], isTypeOnly: false },
      ],
      exports: [],
      calls: [],
      httpCalls: [],
    };

    const result = detectDatabases(tempDir2, [fakeAnalysis], services);
    expect(result.databases.find((db) => db.type === 'postgres')).toBeDefined();
    expect(result.databases.find((db) => db.type === 'redis')).toBeDefined();
    expect(result.databases.find((db) => db.type === 'mongodb')).toBeDefined();

    rmSync(tempDir2, { recursive: true, force: true });
  });
});

describe('detectDatabases Docker-only detection', () => {
  it('detects databases from Docker Compose even without imports', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'truecourse-docker-only-'));

    const srcDir = join(tempDir, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'docker-only', version: '1.0.0' })
    );
    writeFileSync(join(srcDir, 'index.ts'), 'console.log("hello");');
    writeFileSync(
      join(tempDir, 'docker-compose.yml'),
      `services:
  db:
    image: postgres:15
`
    );

    const files = [join(srcDir, 'index.ts')];
    const services = detectServices(tempDir, files);

    // No database imports in the analysis
    const fakeAnalysis: FileAnalysis = {
      filePath: join(srcDir, 'index.ts'),
      language: 'typescript',
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      calls: [],
      httpCalls: [],
    };

    const result = detectDatabases(tempDir, [fakeAnalysis], services);
    // Should detect postgres from Docker Compose even without imports
    const postgresDb = result.databases.find((db) => db.type === 'postgres');
    expect(postgresDb).toBeDefined();
    expect(postgresDb!.name).toBe('db');

    rmSync(tempDir, { recursive: true, force: true });
  });
});
