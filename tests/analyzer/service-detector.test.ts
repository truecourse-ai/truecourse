import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { detectServices } from '../../packages/analyzer/src/service-detector';
import { discoverFiles } from '../../packages/analyzer/src/file-discovery';

const FIXTURE_PATH = new URL('../fixtures/sample-js-project-negative', import.meta.url).pathname;

describe('detectServices with fixture project', () => {
  const fixtureFiles = discoverFiles(FIXTURE_PATH);

  it('detects monorepo structure and finds all services including shared packages', () => {
    const services = detectServices(FIXTURE_PATH, fixtureFiles);
    expect(services.length).toBeGreaterThanOrEqual(3);

    const names = services.map((s) => s.name);
    expect(names).toContain('api-gateway');
    expect(names).toContain('user-service');
    expect(names).toContain('utils');
  });

  it('returns correct service types', () => {
    const services = detectServices(FIXTURE_PATH, fixtureFiles);

    const apiGateway = services.find((s) => s.name === 'api-gateway');
    const userService = services.find((s) => s.name === 'user-service');
    const utils = services.find((s) => s.name === 'utils');

    expect(apiGateway).toBeDefined();
    expect(userService).toBeDefined();
    expect(utils).toBeDefined();

    expect(apiGateway!.type).toBe('api-server');
    expect(userService!.type).toBe('api-server');
    expect(utils!.type).toBe('library');
  });

  it('detects framework for api-gateway and user-service', () => {
    const services = detectServices(FIXTURE_PATH, fixtureFiles);

    const apiGateway = services.find((s) => s.name === 'api-gateway');
    const userService = services.find((s) => s.name === 'user-service');

    expect(apiGateway!.framework).toBe('express');
    expect(userService!.framework).toBe('express');
  });

  it('assigns correct files to each service', () => {
    const services = detectServices(FIXTURE_PATH, fixtureFiles);

    for (const service of services) {
      expect(service.files.length).toBeGreaterThan(0);
      // All files in a service should start with the service's rootPath
      for (const file of service.files) {
        expect(file.startsWith(service.rootPath)).toBe(true);
      }
    }
  });
});

describe('detectServices with single-service project', () => {
  let tempDir: string;

  afterAll(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('falls back to single monolith service when no monorepo patterns found', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'truecourse-test-'));

    // Create a simple single-service project structure
    const srcDir = join(tempDir, 'src');
    mkdirSync(srcDir, { recursive: true });

    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'my-app', version: '1.0.0' })
    );

    writeFileSync(join(srcDir, 'index.ts'), 'console.log("hello");');
    writeFileSync(join(srcDir, 'utils.ts'), 'export const foo = 1;');

    const allFiles = [join(srcDir, 'index.ts'), join(srcDir, 'utils.ts')];
    const services = detectServices(tempDir, allFiles);

    expect(services.length).toBe(1);
    expect(services[0]!.files).toEqual(allFiles);
  });
});
