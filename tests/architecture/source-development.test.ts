import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

describe('workspace source exports', () => {
  it('resolves every library export to source only when explicitly requested', () => {
    for (const base of ['packages', 'ee/packages']) {
      const folder = path.join(root, base);
      if (!fs.existsSync(folder)) continue;
      for (const entry of fs.readdirSync(folder)) {
        const dir = path.join(folder, entry);
        const manifest = path.join(dir, 'package.json');
        if (!fs.existsSync(manifest)) continue;
        const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        if (pkg.scripts?.build !== 'tsc') continue;
        expect(pkg.scripts.dev, pkg.name).toBeUndefined();
        const specifiers = Object.keys(pkg.exports).map(key => pkg.name + (key === '.' ? '' : key.slice(1)));
        const resolve = (source: boolean) => JSON.parse(execFileSync(process.execPath, [
          ...(source ? ['--conditions=truecourse-source'] : []),
          '--input-type=module', '-e',
          `console.log(JSON.stringify(${JSON.stringify(specifiers)}.map(id => import.meta.resolve(id))))`,
        ], { cwd: dir, encoding: 'utf8', timeout: 10000 }));
        const sourcePaths = resolve(true);
        const productionPaths = resolve(false);
        Object.values(pkg.exports).forEach((target: any, i) => {
          const source = path.resolve(dir, target['truecourse-source']);
          expect(fs.existsSync(source), specifiers[i]).toBe(true);
          expect(sourcePaths[i], specifiers[i]).toBe(pathToFileURL(source).href);
          expect(productionPaths[i], specifiers[i]).toBe(pathToFileURL(path.resolve(dir, target.import)).href);
          expect(target.types, specifiers[i]).toMatch(/^\.\/dist\/.*\.d\.ts$/);
        });
      }
    }
  });
});
