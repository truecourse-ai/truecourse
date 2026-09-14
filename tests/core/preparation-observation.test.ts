import { afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertObservationQualification, preparationCatalog, prepareScenario, computePreparationFingerprint, type Recipe } from '@truecourse/guard-runner';
import { qualifyObservations, observationExecutionContract, type ObservationReview } from '../../packages/core/src/services/guard-setup/preparation-observation';
import { buildPreparationSession } from '../../packages/core/src/services/guard-setup/preparation-session';
import { collectGuardSetupBundle, materializeGuardSetupBundle } from '../../packages/core/src/services/guard-setup/bundle';
import { preparationContext } from '../../packages/core/src/services/guard-setup/preparation-context';
import { fixtureReview } from '../guard-runner/preparation-qualification-fixture';
import { memoryPersistence, stubDriver, outcome } from './spec-scan-session-stub';
const roots: string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function fixture() {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tc-observation-'));roots.push(root);
 fs.mkdirSync(path.join(root,'scripts'));fs.writeFileSync(path.join(root,'scripts/server.mjs'), 'export function count(rows) { return rows.length; }\n');
 fs.mkdirSync(path.join(root,'.truecourse/scenarios'),{recursive:true});
 const recipe: Recipe={build:'node should-never-run.cjs',api:{serve:['node','scripts/server.mjs'],healthPath:'/health',seed:{command:'node seed.mjs',provides:{credentials:{owner:{header:'x-world-token'}}}}}};
 fs.writeFileSync(path.join(root,'.truecourse/scenarios/recipe.json'),JSON.stringify(recipe));
 return {root,recipe,review:structuredClone(fixtureReview) as ObservationReview};
}
describe('baseline observation qualification',()=>{
 it('rejects the Expense Tracker review contract and accepts its anonymous correction without CurrencyBeacon',()=>{
  const {root,recipe,review}=fixture();
  delete recipe.api!.seed;
  recipe.api!.externals={currencybeacon:{baseUrlEnv:'CURRENCYBEACON_BASE_URL',env:{CURRENCYBEACON_API_KEY:{}}}};
  const check=review.candidates[0].check;
  check.server='api';
  check.credential='none — route is unauthenticated; send no Authorization header, cookie or credential';
  check.counts={'/totalCount':0};check.totals={'/totalSpentCents':0};
  expect(()=>qualifyObservations(root,recipe,review)).toThrow('dotted response field path');
  check.counts={totalCount:0};check.totals={totalSpentCents:0};
  expect(()=>qualifyObservations(root,recipe,review)).toThrow('Available API servers: default');
  delete check.server;
  expect(()=>qualifyObservations(root,recipe,review)).toThrow('omit credential entirely');
  delete check.credential;
  expect(qualifyObservations(root,recipe,review).size).toBe(1);
  expect(observationExecutionContract(recipe)).toEqual({servers:['default'],defaultServer:'default',webFallback:false,credentials:[]});
 });
 it.each(['/count','$.count','result..count','result[one].count','result.count.'])('rejects unsupported numeric path %s before approval',key=>{
  const {root,recipe,review}=fixture();review.candidates[0].check.counts={[key]:0};
  expect(()=>qualifyObservations(root,recipe,review)).toThrow('dotted response field path');
 });
 it('accepts nested response fields and validates credential server restrictions',()=>{
  const {root,recipe,review}=fixture();
  delete recipe.api!.serve;
  recipe.api!.servers={public:{serve:['node','server.mjs']},admin:{serve:['node','server.mjs']}};
  recipe.api!.defaultServer='public';
  recipe.api!.seed!.provides.credentials!.owner.servers=['admin'];
  review.candidates[0].check.counts={'result.data[0].count':0};
  expect(()=>qualifyObservations(root,recipe,review)).toThrow('not declared by a seed for this server');
  review.candidates[0].check.server='admin';
  expect(qualifyObservations(root,recipe,review).size).toBe(1);
 });
 it('does not treat a supplied external credential as a private seed credential',()=>{
  const {root,recipe,review}=fixture();
  recipe.api!.credentials={external:{header:'Authorization',value:'external-secret'}};
  review.candidates[0].check.credential='external';
  expect(()=>qualifyObservations(root,recipe,review)).toThrow('Available seed credentials: owner');
  expect(JSON.stringify(observationExecutionContract(recipe))).not.toContain('external-secret');
 });
 it('recognizes credential capabilities from an existing preparation',()=>{
  const {root,recipe,review}=fixture();
  delete recipe.api!.seed;
  recipe.preparations={existing:{scope:'instance',baseline:'empty',env:{DATA_FILE:'${directory}/rows.json'},seed:{script:'seed.mjs',provides:{credentials:{owner:{header:'x-world-token'}}}},verify:{script:'verify.mjs'}}};
  expect(qualifyObservations(root,recipe,review).size).toBe(1);
 });
 it('requires an omitted server for a web-only observation and refuses missing surfaces',()=>{
  const {root,recipe,review}=fixture();
  delete recipe.api;
  delete review.candidates[0].check.credential;
  expect(()=>qualifyObservations(root,recipe,review)).toThrow('Available API servers: none');
  recipe.web={serve:['node','scripts/server.mjs']};
  expect(qualifyObservations(root,recipe,review).size).toBe(1);
  review.candidates[0].check.server='default';
  expect(()=>qualifyObservations(root,recipe,review)).toThrow('Omit server to use the web surface');
 });
 it.each(['server','credential','path'] as const)('returns actionable %s corrections before preparation authoring',async defect=>{
  const {root,recipe,review}=fixture();
  recipe.build='true';
  let reviews=0;
  const stub=stubDriver(call=>{
   if(call.def.kind==='guard-setup.preparation-observations'){
    reviews++;
    if(reviews===1){
     expect(call.def.systemPrompt).toContain('"servers":["default"]');
     const invalid=structuredClone(review);
     if(defect==='server') invalid.candidates[0].check.server='api';
     if(defect==='credential') invalid.candidates[0].check.credential='none, unauthenticated';
     if(defect==='path') invalid.candidates[0].check.counts={'/count':0};
     return outcome(invalid);
    }
    const expected={server:'Available API servers: default',credential:'Available seed credentials: owner',path:'dotted response field path'};
    expect(call.input.initialMessages.join(' ')).toContain(expected[defect]);
    return outcome(review);
   }
   expect(reviews).toBe(2);
   expect(JSON.parse(call.briefing).qualifiedObservations).toEqual([review.candidates[0].check]);
   return outcome({profiles:[],findings:['No private profile requested by this fixture']});
  });
  const persistence=memoryPersistence();
  const result=await buildPreparationSession({acquire:async()=>({runId:'r',driver:stub.driver,persistence:persistence.persistence}),note:()=>{},addSpend:()=>{},runId:()=> 'r',usageTotals:()=>null,finish:()=>{}})({repoRoot:root,recipe,specExcerpts:[],fingerprint:'f'});
  expect(result.status).toBe('skipped');expect(reviews).toBe(2);
 });
 it('binds approved paths and configuration to actual source content, invalidating edits',()=>{
  const {root,recipe,review}=fixture();
  const q=[...qualifyObservations(root,recipe,review).values()][0];
  const check={...review.candidates[0].check,qualification:q};
  expect(()=>assertObservationQualification(root,recipe,check)).not.toThrow();
  expect(()=>assertObservationQualification(root,recipe,{...check,path:'/other'})).toThrow('qualification');
  expect(()=>assertObservationQualification(root,{...recipe,api:{...recipe.api,env:{MODE:'tenant'}}},check)).toThrow('qualification');
  fs.writeFileSync(path.join(root,'scripts/server.mjs'),'export function count(rows,user) {return rows.filter(r=>r.user===user).length;}\n');
  expect(()=>assertObservationQualification(root,recipe,check)).toThrow('qualification');
 });
 it.each(['tenant','folder default','deleted rows','page length','windowed count'])('refuses an instance claim with %s counterevidence',filter=>{
  const {root,recipe,review}=fixture();review.candidates[0].implicitFilters=[filter];
  expect(()=>qualifyObservations(root,recipe,review)).toThrow('implicit filters');
 });
 it('refuses fabricated ranges, outside files, missing roles and contradictory decisions',()=>{
  const {root,recipe,review}=fixture();review.candidates[0].sources[0].end=100;
  expect(()=>qualifyObservations(root,recipe,review)).toThrow('range');
  review.candidates[0].sources[0].end=1;review.candidates[0].sources[0].path='../outside';
  expect(()=>qualifyObservations(root,recipe,review)).toThrow();
  review.candidates[0].sources.shift();expect(()=>qualifyObservations(root,recipe,review)).toThrow('authorization source evidence');
  const valid=structuredClone(fixtureReview) as ObservationReview;valid.candidates.push({...valid.candidates[0],decision:'scoped'});
  expect(()=>qualifyObservations(root,recipe,valid)).toThrow('Contradictory');
 });
 it.each(['scoped','unknown'] as const)('stops %s review before installs, builds or scripts and does not invoke authoring',async decision=>{
  const {root,recipe,review}=fixture();recipe.install="node -e \"require('fs').writeFileSync('install-ran','yes')\"";
  fs.writeFileSync(path.join(root,'should-never-run.cjs'),"require('fs').writeFileSync('build-ran','yes')");
  review.candidates[0].decision=decision;
  const stub=stubDriver(call=>{expect(call.def.kind).toBe('guard-setup.preparation-observations');return outcome(review);});
  const persistence=memoryPersistence();
  const result=await buildPreparationSession({acquire:async()=>({runId:'r',driver:stub.driver,persistence:persistence.persistence}),note:()=>{},addSpend:()=>{},runId:()=> 'r',usageTotals:()=>null,finish:()=>{}})({repoRoot:root,recipe,specExcerpts:[],fingerprint:'f'});
  expect(result.status).toBe('skipped');expect(result.reason).toContain('No instance-wide');
  expect(stub.calls).toHaveLength(1);expect(fs.existsSync(path.join(root,'install-ran'))).toBe(false);expect(fs.existsSync(path.join(root,'build-ran'))).toBe(false);
 });
 it('withholds qualification for a real principal-scoped count that reports zero over nonempty data',async()=>{
  const {root,recipe,review}=fixture();
  const source="export function count(rows, principal) { return rows.filter(row => row.owner === principal).length; }\n";
  fs.writeFileSync(path.join(root,'scripts/server.mjs'), source);
  const {count}=await import((await import('node:url')).pathToFileURL(path.join(root,'scripts/server.mjs')).href);
  const rows=[{owner:'B'}];
  expect(count(rows,'A')).toBe(0);expect(count(rows,'B')).toBe(1);
  review.candidates[0].decision='scoped';
  review.candidates[0].implicitFilters=['row.owner === principal'];
  review.candidates[0].counterevidence=['A observes zero while B owns a business record'];
  // The reviewer must recognize the source semantics; the engine enforces its decision.
  expect(qualifyObservations(root,recipe,review).size).toBe(0);
  review.candidates[0].decision='instance';
  expect(()=>qualifyObservations(root,recipe,review)).toThrow('implicit filters');
 });
 it('keeps inline-secret rotation neutral but binds credential capabilities',()=>{
  const {root,recipe,review}=fixture();recipe.api!.credentials={admin:{header:'Authorization',value:'initial-secret'}};
  const q=[...qualifyObservations(root,recipe,review).values()][0];
  const check={...review.candidates[0].check,qualification:q};
  recipe.api!.credentials!.admin.value='rotated-secret';
  expect(()=>assertObservationQualification(root,recipe,check)).not.toThrow();
  delete recipe.api!.credentials!.admin.value;
  expect(()=>assertObservationQualification(root,recipe,check)).not.toThrow();
  recipe.api!.credentials!.admin.header='x-other';
  expect(()=>assertObservationQualification(root,recipe,check)).toThrow('qualification');
 });
 it('redacts source and briefing using inline credentials and server environment values',async()=>{
  const {root,recipe,review}=fixture();
  recipe.env={DATABASE_URL:'postgres://user:db-password@localhost/private'};
  recipe.api!.credentials={admin:{header:'Authorization',value:'inline-test-secret'}};
  recipe.api!.servers={api:{serve:['node','server.mjs'],env:{SERVER_KEY:'server-test-secret'}}};
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({comment:'inline-test-secret server-test-secret db-password'}));
  review.candidates[0].decision='unknown';
  const stub=stubDriver(call=>{
   for(const secret of ['inline-test-secret','server-test-secret','db-password','postgres://user']) expect(call.briefing).not.toContain(secret);
   return outcome(review);
  });
  const persistence=memoryPersistence();
  const result=await buildPreparationSession({acquire:async()=>({runId:'r',driver:stub.driver,persistence:persistence.persistence}),note:()=>{},addSpend:()=>{},runId:()=> 'r',usageTotals:()=>null,finish:()=>{}})({repoRoot:root,recipe,specExcerpts:[],fingerprint:'f'});
  expect(result.status).toBe('skipped');
 });
 it('keeps legacy recipes readable but refuses unqualified execution and catalog readiness',async()=>{
  const {root,recipe}=fixture();recipe.preparations={empty:{scope:'instance',baseline:'empty',env:{DATA_FILE:'${directory}/rows.json'},baselineChecks:[{path:'/rows',counts:{count:0}}],seed:{script:'missing.mjs',provides:{}},verify:{script:'missing.mjs'}}};
  expect(preparationCatalog(recipe,root)).toEqual([]);
  await expect(prepareScenario({repoRoot:root,recipe,profile:'empty'})).rejects.toThrow('qualification');
 });
 it('invalidates preparation fingerprints and catalog entries when qualified query source changes',()=>{
  const {root,recipe,review}=fixture();const q=[...qualifyObservations(root,recipe,review).values()][0];
  recipe.preparations={known:{scope:'instance',baseline:'empty',env:{DATA_FILE:'${directory}/rows.json'},baselineChecks:[{...review.candidates[0].check,qualification:q}],seed:{script:'seed.mjs',provides:{}},verify:{script:'verify.mjs'}}};
  fs.writeFileSync(path.join(root,'.truecourse/scenarios/recipe.json'),JSON.stringify(recipe));
  const before=computePreparationFingerprint(root);expect(preparationCatalog(recipe,root)).toHaveLength(1);
  fs.appendFileSync(path.join(root,'scripts/server.mjs'),'// changed query\n');
  expect(computePreparationFingerprint(root)).not.toBe(before);expect(preparationCatalog(recipe,root)).toEqual([]);
 });
 it('keeps qualification usable when a saved bundle is restored to a fresh checkout',()=>{
  const {root,recipe,review}=fixture();const fresh=fixture().root;
  const q=[...qualifyObservations(root,recipe,review).values()][0];
  recipe.preparations={empty:{scope:'instance',baseline:'empty',env:{DATA_FILE:'${directory}/rows.json'},baselineChecks:[{...review.candidates[0].check,qualification:q}],seed:{script:'scripts/seed.mjs',provides:{}},verify:{script:'scripts/verify.mjs'}}};
  for(const name of ['seed','verify'])fs.writeFileSync(path.join(root,`scripts/${name}.mjs`),'// saved preparation script');
  fs.writeFileSync(path.join(root,'.truecourse/scenarios/recipe.json'),JSON.stringify(recipe));
  const bundle=collectGuardSetupBundle(root);materializeGuardSetupBundle(fresh,bundle);
  const restored=JSON.parse(fs.readFileSync(path.join(fresh,'.truecourse/scenarios/recipe.json'),'utf8'));
  expect(preparationCatalog(restored,fresh)).toHaveLength(1);
  expect(collectGuardSetupBundle(fresh)).toEqual(bundle);
 });
 it('bounds context, redacts credentials and records source changes',()=>{
  const {root,recipe}=fixture();fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({secret:'supplied-test-token',padding:'x'.repeat(30000)}));
  const redact=(s:string)=>s.replaceAll('supplied-test-token','[masked]');
  fs.mkdirSync(path.join(root,'.truecourse/guard'),{recursive:true});
  fs.writeFileSync(path.join(root,'.truecourse/guard/interfaces.json'),JSON.stringify({interfaces:Array.from({length:100},(_,i)=>({type:'api',entry:{method:'GET',path:'/rows/'+i},title:'supplied-test-token'+('x'.repeat(i===0?10000:100))}))}));
  const first=preparationContext(root,recipe,redact);
  expect(first.omittedRoutes).toBeGreaterThan(0);expect(Buffer.byteLength(JSON.stringify(first.candidateRoutes))).toBeLessThanOrEqual(8200);
  expect(JSON.stringify(first)).not.toContain('supplied-test-token');
  expect(first.files.reduce((sum,f)=>sum+Buffer.byteLength(f.content),0)).toBeLessThanOrEqual(24000);expect(first.files[0].omitted).toBe(true);
  recipe.api!.env={UPLOAD_TRANSPORT:'database'};
  expect(preparationContext(root,recipe,redact).fingerprint).not.toBe(first.fingerprint);
  delete recipe.api!.env;
  fs.appendFileSync(path.join(root,'package.json'),'\n');expect(preparationContext(root,recipe,redact).fingerprint).not.toBe(first.fingerprint);
 });
});
