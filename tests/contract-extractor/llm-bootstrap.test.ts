import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { proposeWithLlm } from '../../packages/contract-extractor/src/llm-bootstrap.js';
import type { BootstrapCandidate } from '../../packages/contract-extractor/src/bootstrap.js';

/**
 * The LLM bootstrap shells out to `claude -p`. To test the parsing /
 * validation / shape-mapping path without a real subprocess, we stub
 * `child_process.spawn` via vi.mock and feed canned stdout.
 */

vi.mock('node:child_process', () => {
  const { EventEmitter } = require('node:events') as typeof import('node:events');
  return {
    spawn: (..._args: unknown[]) => {
      const proc: any = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => undefined;

      // Driver populated per-test via global hook. Lets each test feed a
      // different canned response without redefining the mock.
      const driver = (globalThis as any).__claudeMockDriver as
        | ((p: any) => void)
        | undefined;
      setImmediate(() => {
        if (driver) driver(proc);
        else proc.emit('close', 1);
      });
      return proc;
    },
  };
});

const candidates: BootstrapCandidate[] = [
  { file: 'SPEC.md', kind: 'base-spec', preview: '# Spec\nBody.' },
  { file: 'docs/adr/0001-foo.md', kind: 'adr-series', preview: '# ADR-1\nBody.' },
  { file: 'README.md', kind: 'overview', preview: '# README\nBody.' },
];

function setMockDriver(fn: (proc: any) => void): void {
  (globalThis as any).__claudeMockDriver = fn;
}

describe('LLM bootstrap', () => {
  beforeEach(() => {
    setMockDriver(() => undefined);
  });
  afterEach(() => {
    delete (globalThis as any).__claudeMockDriver;
  });

  it('parses a well-formed Claude Code response into a proposal', async () => {
    const proposalJson = JSON.stringify({
      summary: 'Order management service with one base spec and one ADR.',
      specs: [
        { file: 'SPEC.md', rank: 0, reason: 'Foundational service contract.' },
        { file: 'docs/adr/*.md', rank: 1, reason: 'ADR series amends the base.' },
      ],
      excluded: [{ file: 'README.md', reason: 'Overview, not a spec.' }],
    });
    const envelope = JSON.stringify({ result: proposalJson });
    setMockDriver((proc) => {
      proc.stdout.emit('data', Buffer.from(envelope));
      proc.emit('close', 0);
    });

    const result = await proposeWithLlm(candidates);
    expect(result.proposal.config.specs).toHaveLength(2);
    expect(result.proposal.config.specs[0]).toEqual({ file: 'SPEC.md', rank: 0 });
    expect(result.proposal.excluded).toHaveLength(1);
    expect(result.reasons.get('SPEC.md')).toBe('Foundational service contract.');
    expect(result.summary).toContain('Order management');
  });

  it('strips a leading ```json code fence the model occasionally adds', async () => {
    const proposalJson = JSON.stringify({
      specs: [{ file: 'SPEC.md', rank: 0, reason: 'Base spec.' }],
      excluded: [],
    });
    const fenced = '```json\n' + proposalJson + '\n```';
    const envelope = JSON.stringify({ result: fenced });
    setMockDriver((proc) => {
      proc.stdout.emit('data', Buffer.from(envelope));
      proc.emit('close', 0);
    });

    const result = await proposeWithLlm(candidates);
    expect(result.proposal.config.specs).toEqual([{ file: 'SPEC.md', rank: 0 }]);
  });

  it('rejects on subprocess failure so the caller can fall back', async () => {
    setMockDriver((proc) => {
      proc.stderr.emit('data', Buffer.from('boom'));
      proc.emit('close', 1);
    });
    await expect(proposeWithLlm(candidates)).rejects.toThrow(/exited 1/);
  });

  it('rejects when the model output fails Zod validation', async () => {
    const malformed = JSON.stringify({ result: JSON.stringify({ specs: 'oops' }) });
    setMockDriver((proc) => {
      proc.stdout.emit('data', Buffer.from(malformed));
      proc.emit('close', 0);
    });
    await expect(proposeWithLlm(candidates)).rejects.toThrow();
  });

  it('rejects when --output-format json envelope has no text payload', async () => {
    const envelope = JSON.stringify({ unrelated: 'value' });
    setMockDriver((proc) => {
      proc.stdout.emit('data', Buffer.from(envelope));
      proc.emit('close', 0);
    });
    await expect(proposeWithLlm(candidates)).rejects.toThrow(/no text/);
  });
});
