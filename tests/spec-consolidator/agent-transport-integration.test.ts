import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { consolidate } from '../../packages/spec-consolidator/src/index.js';
import { agentTransport } from '../../packages/shared/src/llm/transport.js';

/**
 * Drives the full consolidator pipeline through the **agent** transport — no
 * `claude` subprocess. A concurrent "answerer" plays the routine's role: it
 * watches the mailbox and writes a schema-valid response per request stage.
 * Proves the transport seam threads orchestrator → every runner end-to-end.
 */

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

function tmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

function answerFor(stage: string | undefined, responseFormat: string | undefined): string {
  switch (stage) {
    case 'spec.relevance':
      return JSON.stringify({ include: true, reason: 'spec source' });
    case 'spec.claimExtract':
      return JSON.stringify({ topics: [], claims: [] });
    case 'spec.chainDetect':
      return JSON.stringify({ chains: [] });
    case 'spec.chainRecheck':
      return JSON.stringify({ superseded: false, reason: 'distinct' });
    case 'spec.conflictResolve':
      return JSON.stringify({ pick: 0, confidence: 'low', reasoning: 'n/a' });
    case 'spec.conflictExplain':
      return 'no material conflict';
    default:
      return responseFormat === 'text' ? '' : '{}';
  }
}

/** Mailbox pump: answer any request that doesn't yet have a response. */
function startAnswerer(io: string): () => void {
  const reqDir = path.join(io, 'requests');
  const resDir = path.join(io, 'responses');
  const seen = new Set<string>();
  const timer = setInterval(() => {
    if (!fs.existsSync(reqDir)) return;
    for (const f of fs.readdirSync(reqDir)) {
      if (!f.endsWith('.json') || seen.has(f)) continue;
      const resPath = path.join(resDir, f);
      if (fs.existsSync(resPath)) { seen.add(f); continue; }
      let req: { stage?: string; responseFormat?: string };
      try { req = JSON.parse(fs.readFileSync(path.join(reqDir, f), 'utf-8')); } catch { continue; }
      const tmpPath = `${resPath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify({ text: answerFor(req.stage, req.responseFormat) }));
      fs.renameSync(tmpPath, resPath);
      seen.add(f);
    }
  }, 10);
  return () => clearInterval(timer);
}

describe('agent transport — full consolidate pipeline', () => {
  it('scans a repo end-to-end with no claude subprocess', async () => {
    const repo = tmp('tc-agent-repo-');
    const io = tmp('tc-agent-io-');
    fs.writeFileSync(
      path.join(repo, 'spec.md'),
      '# Orders API\n\n## Create order\n\n`POST /api/orders` creates an order and returns 201 with the id.\n',
    );

    const stop = startAnswerer(io);
    try {
      const result = await consolidate(repo, {
        transport: agentTransport(io, { pollMs: 10 }),
        skipGit: true,
      });
      // The pipeline ran to completion driven entirely by mailbox answers.
      expect(result.extract.docsScanned).toBeGreaterThan(0);
      expect(result.extract.blocksAttempted).toBeGreaterThan(0);
      expect(Array.isArray(result.claimEntries)).toBe(true);
      // claims.json was materialized.
      expect(fs.existsSync(path.join(repo, '.truecourse/specs/claims.json'))).toBe(true);
    } finally {
      stop();
    }
  }, 30_000);
});
