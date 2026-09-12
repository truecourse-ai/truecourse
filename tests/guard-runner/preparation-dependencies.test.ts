import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { preparationDependencyBriefing, resolvePreparationDependencies } from '../../packages/guard-runner/src/preparation-dependencies';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
function fixture(env: Record<string, string> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-preparation-dependencies-'));
  roots.push(root);
  const directory = path.join(root, '.truecourse/scenarios');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'dependencies.json'), JSON.stringify({ dependencies: [{
    name: 'aws', class: 'supplied', summary: 'S3 object storage', services: ['s3'], needs: [],
    condition: { predicates: [{ kind: 'config-value', key: 'NEXT_PUBLIC_UPLOAD_TRANSPORT', value: 's3' }], sentence: 'Only S3-backed operations' },
    registration: { kind: 'env', vars: [
      { name: 'AWS_ACCESS_KEY_ID', description: 'Key ID', secret: true },
      { name: 'AWS_SECRET_ACCESS_KEY', description: 'Secret', secret: true },
    ] },
  }] }));
  fs.writeFileSync(path.join(directory, 'dependencies.local.json'), JSON.stringify({ aws: { env } }));
  return root;
}

describe('preparation dependency resolution', () => {
  it.each(['aws', 's3'])('blocks unavailable canonical or service-alias requirement %s', name => {
    const root = fixture();
    expect(() => resolvePreparationDependencies(root, { build: 'true' }, [name])).toThrow('unprovided');
    expect(() => resolvePreparationDependencies(root, { build: 'true' }, [])).not.toThrow();
  });

  it('does not mistake a partial account or recipe env for a provided registration', () => {
    const root = fixture({ AWS_ACCESS_KEY_ID: 'partial-account' });
    const recipe = { build: 'true', env: { AWS_SECRET_ACCESS_KEY: 'recipe-secret' } };
    expect(() => resolvePreparationDependencies(root, recipe, ['aws'])).toThrow('incomplete');
    const briefing = JSON.stringify(preparationDependencyBriefing(root, recipe));
    expect(briefing).toContain('incomplete');
    expect(briefing).toContain('Only S3-backed operations');
    expect(briefing).not.toContain('partial-account');
    expect(briefing).not.toContain('recipe-secret');
  });

  it('injects declared provided accounts and redacts their secrets without exposing values in the briefing', () => {
    const root = fixture({ AWS_ACCESS_KEY_ID: 'provided-id', AWS_SECRET_ACCESS_KEY: 'provided-secret' });
    const account = resolvePreparationDependencies(root, { build: 'true' }, ['s3']);
    expect(account.env).toMatchObject({ AWS_ACCESS_KEY_ID: 'provided-id', AWS_SECRET_ACCESS_KEY: 'provided-secret' });
    expect([...account.secrets.values()]).toContain('provided-secret');
    expect(resolvePreparationDependencies(root, { build: 'true' }, []).env).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
    const briefing = JSON.stringify(preparationDependencyBriefing(root, { build: 'true' }));
    expect(briefing).toContain('provided');
    expect(briefing).not.toContain('provided-id');
    expect(briefing).not.toContain('provided-secret');
  });

  it.each(['path', 'config-dir'])('refuses %s registrations instead of pretending the instance was materialized', kind => {
    const root = fixture();
    fs.writeFileSync(path.join(root, '.truecourse/scenarios/dependencies.json'), JSON.stringify({ dependencies: [{
      name: 'login', class: 'supplied', summary: 'Login state', needs: [],
      registration: { kind, description: 'Supplied login', ...(kind === 'config-dir' ? { homePath: '.login' } : {}) },
    }] }));
    fs.writeFileSync(path.join(root, '.truecourse/scenarios/dependencies.local.json'), JSON.stringify({ login: { path: root } }));
    expect(() => resolvePreparationDependencies(root, { build: 'true' }, ['login'])).toThrow('materialization');
  });

  it('refuses unknown names and malformed catalogs', () => {
    const root = fixture();
    expect(() => resolvePreparationDependencies(root, { build: 'true' }, ['invented'])).toThrow('unknown prerequisite');
    fs.writeFileSync(path.join(root, '.truecourse/scenarios/dependencies.json'), '{"dependencies":"invalid"}');
    expect(() => resolvePreparationDependencies(root, { build: 'true' }, [])).toThrow('dependencies.json');
  });
});
