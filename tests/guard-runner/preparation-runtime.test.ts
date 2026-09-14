import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runSeed, stagePreparationRuntime, cleanupPreparationRuntime } from '@truecourse/guard-runner';
const require = createRequire(import.meta.url);
const roots: string[] = [];
afterEach(()=>{ for(const root of roots.splice(0)) fs.rmSync(root,{recursive:true,force:true}); });
function fixture(type = 'commonjs', installed = true) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tc-preparation-runtime-')); roots.push(root);
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({type}));
 if(installed) {fs.mkdirSync(path.join(root,'node_modules')); fs.symlinkSync(path.dirname(require.resolve('tsx/package.json')),path.join(root,'node_modules/tsx'),'dir');}
 fs.writeFileSync(path.join(root,'model.ts'), 'export const value = 42;');
 fs.writeFileSync(path.join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{baseUrl:'.',paths:{'@fixture/*':['./*']}}}));
 const runtime=stagePreparationRuntime(root);
 return {root,runtime};
}
function execute(root: string, runtime: string, body: string, imports = "import { value } from '@fixture/model'; import fs from 'node:fs';", packageDir = '.', options: {signal?: AbortSignal; helperTimeoutMs?: number} = {}) {
 fs.writeFileSync(path.join(root,'seed.mjs'), `import {pathToFileURL} from 'node:url'; const {runTypeScript}=await import(pathToFileURL(process.env.GUARD_PREPARATION_RUNTIME).href); await runTypeScript(${JSON.stringify({packageDir,imports,body,timeoutMs:options.helperTimeoutMs})});`);
 return runSeed({repoRoot:root,signal:options.signal,seed:{command:'node seed.mjs',provides:{fixtures:{result:['value']}}},env:{GUARD_REPO_ROOT:root,GUARD_PREPARATION_RUNTIME:runtime,PRIVATE_TEST:'isolated'}});
}
describe('preparation TypeScript runtime',()=>{
 it.each(['commonjs','module'])('runs an async helper with extensionless imports and aliases in %s',async type=>{
  const {root,runtime}=fixture(type);
  const result=await execute(root,runtime,"await Promise.resolve(); fs.writeFileSync(process.env.GUARD_SEED_OUT!, JSON.stringify({fixtures:{result:{value: value + ':' + process.env.PRIVATE_TEST}}}));");
  expect(result.fixtures.get('result')).toEqual({value:'42:isolated'});
  expect(fs.readdirSync(root).filter(n=>n.startsWith('.guard-preparation-'))).toEqual([]);
 });
 it('preserves compiler errors and removes failed helpers',async()=>{
  const {root,runtime}=fixture();
  await expect(execute(root,runtime,'const = broken;')).rejects.toThrow(/Transform failed|Unexpected/);
  expect(fs.readdirSync(root).filter(n=>n.startsWith('.guard-preparation-'))).toEqual([]);
 });
 it('uses distinct helper files for concurrent executions',async()=>{
  const {root,runtime}=fixture();
  const body="await new Promise(resolve => setTimeout(resolve, 100)); fs.writeFileSync(process.env.GUARD_SEED_OUT!, JSON.stringify({fixtures:{result:{value:fs.readdirSync('.').filter(n=>n.startsWith('.guard-preparation-')).length}}}));";
  const results=await Promise.all([execute(root,runtime,body),execute(root,runtime,body)]);
  expect(results.some(r=>r.fixtures.get('result')?.value===2)).toBe(true);
  expect(fs.readdirSync(root).filter(n=>n.startsWith('.guard-preparation-')||n.startsWith('helper-'))).toEqual([]);
 });
 it('cleans a timed-out helper while preserving its failure',async()=>{
  const {root,runtime}=fixture();
  await expect(execute(root,runtime,'await new Promise(() => setInterval(() => {}, 1000));', '', '.', {helperTimeoutMs:100})).rejects.toThrow('TypeScript preparation helper failed');
  expect(fs.readdirSync(root).filter(n=>n.startsWith('.guard-preparation-')||n.startsWith('helper-'))).toEqual([]);
 });
 it('lets the owning world remove helpers after forced cancellation',async()=>{
  const {root,runtime}=fixture();const controller=new AbortController();
  const pending=execute(root,runtime,"fs.writeFileSync('started', 'yes'); await new Promise(() => setInterval(() => {}, 1000));", "import fs from 'node:fs';", '.', {signal:controller.signal}).catch(error=>error);
  try {
   await expect.poll(()=>fs.existsSync(path.join(root,'started'))).toBe(true);
   controller.abort();
   expect(await pending).toBeInstanceOf(Error);
   cleanupPreparationRuntime(root,root);
   expect(fs.readdirSync(root).filter(n=>n.startsWith('.guard-preparation-')||n.startsWith('helper-'))).toEqual([]);
  } finally { controller.abort(); await pending; }
 });
 it('refuses a missing repository executor without downloading anything',async()=>{
  const {root,runtime}=fixture('commonjs',false);
  await expect(execute(root,runtime,'')).rejects.toThrow('repository-declared tsx');
  expect(fs.existsSync(path.join(root,'node_modules'))).toBe(false);
 });
 it('refuses a package directory outside the repository',async()=>{
  const {root,runtime}=fixture();
  fs.symlinkSync(os.tmpdir(),path.join(root,'escape'),'dir');
  await expect(execute(root,runtime,'','', 'escape')).rejects.toThrow('escapes repository');
 });
});
