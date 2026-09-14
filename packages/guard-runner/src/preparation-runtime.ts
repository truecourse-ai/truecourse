import fs from 'node:fs';
import path from 'node:path';

/** Standalone JS, packaged as a string so bundled CLI and hosted clones agree. */
export const PREPARATION_RUNTIME_SOURCE = `import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
export async function runTypeScript({ packageDir = '.', imports = '', body, timeoutMs = 120000 }) {
  if (typeof body !== 'string' || typeof imports !== 'string') throw Error('TypeScript imports and async body must be strings');
  const root = fs.realpathSync(process.env.GUARD_REPO_ROOT);
  const dir = fs.realpathSync(path.resolve(root, packageDir));
  const rel = path.relative(root, dir);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw Error('TypeScript package directory escapes repository');
  const require = createRequire(path.join(dir, 'package.json'));
  let loader;
  try { loader = require.resolve('tsx'); }
  catch { throw Error('Install the repository-declared tsx executor before running TypeScript preparation helpers'); }
  const id = randomUUID();
  const file = path.join(dir, '.guard-preparation-' + id + '.ts');
  const registration = path.join(path.dirname(fileURLToPath(import.meta.url)), 'helper-' + id + '.json');
  fs.writeFileSync(registration, JSON.stringify({ file }), { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(file, imports + '\\nasync function main() {\\n' + body + '\\n}\\nmain().catch(error => { console.error(error); process.exitCode = 1; });\\n', { flag: 'wx', mode: 0o600 });
  let child, timer;
  const forward = () => child?.kill('SIGTERM');
  process.on('SIGTERM', forward); process.on('SIGINT', forward);
  try {
    await new Promise((resolve, reject) => {
      child = spawn(process.execPath, ['--import', pathToFileURL(loader).href, file], { cwd: dir, env: process.env, stdio: ['ignore', 'inherit', 'inherit'] });
      timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      child.on('error', reject);
      child.on('close', (code, signal) => code === 0 ? resolve() : reject(Error('TypeScript preparation helper failed: exit ' + code + ', signal ' + signal + '. See child diagnostic above.')));
    });
  } finally {
    clearTimeout(timer); process.off('SIGTERM', forward); process.off('SIGINT', forward);
    fs.rmSync(file, { force: true });
    fs.rmSync(registration, { force: true });
  }
}
`;

export function stagePreparationRuntime(directory: string): string {
  const file = path.join(directory, 'runtime.mjs');
  fs.writeFileSync(file, PREPARATION_RUNTIME_SOURCE, { flag: 'wx', mode: 0o600 });
  return file;
}

/** The owning runner removes helpers even when SIGKILL prevents the script's finally. */
export function cleanupPreparationRuntime(directory: string, repoRoot: string): void {
  const root = fs.realpathSync(repoRoot);
  for (const name of fs.readdirSync(directory)) {
    const match = /^helper-([a-f0-9-]{36})\.json$/.exec(name);
    if (!match) continue;
    const registration = path.join(directory, name);
    const {file} = JSON.parse(fs.readFileSync(registration, 'utf8'));
    if (typeof file !== 'string' || path.basename(file) !== `.guard-preparation-${match[1]}.ts`)
      throw Error('Invalid preparation helper ownership record');
    const dir = fs.realpathSync(path.dirname(file));
    const relative = path.relative(root, dir);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
      throw Error('Preparation helper cleanup escapes repository');
    fs.rmSync(path.join(dir, path.basename(file)), {force: true});
    fs.rmSync(registration);
  }
}

export const PREPARATION_RUNTIME_GUIDANCE = `For TypeScript app modules, use the engine helper rather than plain Node imports or npx:
const { runTypeScript } = await import((await import('node:url')).pathToFileURL(process.env.GUARD_PREPARATION_RUNTIME).href);
await runTypeScript({packageDir: 'actual/package', imports: "import { prisma } from './index';", body: "// await app provisioning here; publish GUARD_SEED_OUT; disconnect clients"});
The helper resolves the app's installed tsx, writes a unique file under that package, wraps body in async main, preserves private env and child errors, and removes it. imports contains only top-level imports; body contains async provisioning. Do not put top-level await in imports. Do not copy populated main-seed records into an empty profile.`;
