import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BaseCLIProvider } from '../../packages/core/src/services/llm/cli-provider.js';
import { agentTransport, type LlmTransport } from '../../packages/shared/src/llm/transport.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Minimal concrete provider exposing the protected spawn+parse for testing. */
class TestProvider extends BaseCLIProvider {
  get binaryName(): string {
    return 'claude';
  }
  get baseArgs(): string[] {
    return [];
  }
  get modelFlag(): string[] {
    return [];
  }
  run<T>(prompt: string, schema: z.ZodType<T>): Promise<{ data: T }> {
    return this.spawnAndParse(prompt, schema, { label: 'unit' });
  }
}

describe('analyze LLM provider — agent transport', () => {
  it('routes the call through the transport (no claude spawn) and validates the answer', async () => {
    const seen: Array<{ stage?: string; user: string; schema?: string }> = [];
    const transport: LlmTransport = async (req) => {
      seen.push({ stage: req.stage, user: req.user, schema: req.schema });
      return JSON.stringify({ ok: true, n: 7 });
    };
    const provider = new TestProvider(transport);
    const schema = z.object({ ok: z.boolean(), n: z.number() });

    const { data } = await provider.run('THE PROMPT', schema);

    expect(data).toEqual({ ok: true, n: 7 });
    expect(seen[0].user).toBe('THE PROMPT');
    expect(seen[0].stage).toBe('analyze.unit');
    expect(seen[0].schema).toContain('ok'); // the JSON-schema string is forwarded to the answerer
  });

  it('works end-to-end through the agentTransport filesystem mailbox', async () => {
    const io = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-analyze-io-'));
    const provider = new TestProvider(agentTransport(io, { pollMs: 10 }));
    const schema = z.object({ value: z.string() });

    const pending = provider.run('P', schema);

    // play the answering agent: find the request, write a schema-valid answer
    const reqDir = path.join(io, 'requests');
    for (let i = 0; i < 200; i++) {
      if (fs.existsSync(reqDir) && fs.readdirSync(reqDir).length > 0) break;
      await sleep(5);
    }
    const file = fs.readdirSync(reqDir)[0];
    fs.writeFileSync(
      path.join(io, 'responses', file),
      JSON.stringify({ text: JSON.stringify({ value: 'hi' }) }),
    );

    const { data } = await pending;
    expect(data).toEqual({ value: 'hi' });
  });
});
