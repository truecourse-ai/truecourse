import { z } from 'zod';
import { memoryPersistence, stubDriver, outcome } from './spec-scan-session-stub';
import { it, expect } from 'vitest';
import { SeedError } from '@truecourse/guard-runner';
import { runAgentLoop, type SessionEvent, type ToolContext } from '../../packages/agent-loop/src/index';
import { preparationDiagnostic, preparationDiagnosticTool } from '../../packages/core/src/services/guard-setup/preparation-diagnostics';
it('retains primary and cleanup diagnostics and pages only session-owned evidence',async()=>{
 const primary=new SeedError('child failed',{version:1,output:'💚'.repeat(9000)+'secret-value',retainedBytes:0,totalBytes:0,omittedBytes:0,exitCode:1,signal:null,timedOut:false});
 const artifact=preparationDiagnostic(new AggregateError([primary,Error('cleanup failed')],'both failed'),s=>s.replaceAll('secret-value','[masked]'));
 expect(artifact.message).toContain('cleanup failed');expect(artifact.output).not.toContain('secret-value');
 const event: SessionEvent={seq:0,ts:new Date().toISOString(),type:'tool-result',toolName:'verify_preparations',isError:true,content:'failed',artifact};
 const ctx:ToolContext={workItem:'preparations',signal:new AbortController().signal,dispatchChild:async()=>{throw Error('no child');},readEvents:()=>[event]};
 const tool=preparationDiagnosticTool();const first=JSON.parse((await tool.execute({id:artifact.id,offset:0},ctx)).content);
 expect(first.nextOffset).toBe(8000);expect(first.text).not.toContain('�');
 expect(JSON.parse((await tool.execute({id:artifact.id,offset:first.nextOffset},ctx)).content).nextOffset).toBeNull();
 expect((await tool.execute({id:artifact.id,offset:0},{...ctx,readEvents:()=>[]})).isError).toBe(true);
});

it('retrieves persisted diagnostic evidence through explicit resume ancestry only',async()=>{
 const artifact=preparationDiagnostic(Error('original compiler cause'),s=>s);
 const {persistence}=memoryPersistence();
 persistence.appendEvent('parent',{seq:0,ts:new Date().toISOString(),type:'tool-result',toolName:'verify_preparations',content:'failed',artifact});
 const tool=preparationDiagnosticTool();
 const stub=stubDriver(async call=>{
  const result=await call.def.tools[0].execute({id:artifact.id},{workItem:'preparations',signal:new AbortController().signal,dispatchChild:async()=>{throw Error('no child');}});
  expect(result.isError).not.toBe(true);expect(result.content).toContain('original compiler cause');
  return outcome({ok:true});
 });
 const result=await runAgentLoop({sessionId:'child',resume:{of:'parent'},workItem:'preparations',initialMessages:[],persistence,driver:stub.driver,
  def:{kind:'diagnostic-test',systemPrompt:'test',budget:{turns:2,maxResumes:0,tokenCeiling:1000},tools:[tool],outcomeSchema:z.object({ok:z.boolean()})}}).outcome;
 expect(result.status).toBe('completed');
});
