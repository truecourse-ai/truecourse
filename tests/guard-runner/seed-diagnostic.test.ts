import { describe, it, expect } from 'vitest';
import { SeedOutputCapture, seedDiagnosticSummary } from '../../packages/guard-runner/src/api/seed-diagnostic';
import { buildCredentialRedactor } from '@truecourse/guard-runner';
describe('seed diagnostic retention',()=>{
 it('retains a child error before a verbose wrapper stack',()=>{
  const output='migrations applied\nError: top-level await is not supported\n'+('wrapper source'.repeat(500))+'\nError: npx failed\n';
  expect(seedDiagnosticSummary(output)).toContain('top-level await is not supported');
 });
 it('drains bounded output, preserves middle errors and drops oversized lines whole',()=>{
  const c=new SeedOutputCapture();
  c.push('stdout',Buffer.from('secret'.repeat(20000)+'\n'));
  c.push('stderr',Buffer.from('Error: ORIGINAL compiler failure\n'));
  for(let i=0;i<30000;i++)c.push('stdout',Buffer.from('ordinary migration output '.repeat(3)+'\n'));
  const output=c.finish();
  expect(output).toContain('Error: ORIGINAL');expect(output).not.toContain('secret');
  expect(c.omittedBytes).toBeGreaterThan(0);expect(Buffer.byteLength(output)).toBeLessThanOrEqual(SeedOutputCapture.limit);
 });
 it('decodes split UTF8 and credentials before masking',()=>{
  const c=new SeedOutputCapture(); const bytes=Buffer.from('💚 token-secret\n');
  for(const byte of bytes)c.push('stderr',Buffer.from([byte]));
  expect(buildCredentialRedactor(new Map([['token','token-secret']]))(c.finish())).toBe('💚 «cred:token»\n');
 });
 it('masks original input once and preserves existing masks across redactors',()=>{
  const first=buildCredentialRedactor(new Map([['db.password','password'],['token','long-secret']]));
  const text=first('password long-secret');
  expect(text).toBe('«cred:db.password» «cred:token»');
  expect(first(text)).toBe(text);
  expect(buildCredentialRedactor(new Map([['next','password']]))(text)).toBe(text);
 });
});
