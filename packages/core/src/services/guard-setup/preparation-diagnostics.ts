import { randomUUID } from 'node:crypto';
import { defineSessionTool } from '@truecourse/agent-loop';
import { SeedError, type SeedDiagnostic } from '@truecourse/guard-runner';
import { z } from 'zod';

const EvidenceSchema = z.object({ kind: z.literal('preparation-diagnostic'), id: z.string().uuid(), output: z.string(), message: z.string() });
export function preparationDiagnostic(error: unknown, redact: (s: string) => string) {
  const diagnostics: SeedDiagnostic[] = [];
  const messages: string[] = [];
  function visit(e: unknown) {
    messages.push(e instanceof Error ? e.message : String(e));
    if (e instanceof SeedError && e.diagnostic) diagnostics.push(e.diagnostic);
    if (e instanceof AggregateError) for (const child of e.errors) visit(child);
  }
  visit(error);
  const message = redact(messages.join('\n')).slice(0, 12000);
  const output = redact(diagnostics.map((d, i) => `Diagnostic ${i + 1}: exit=${d.exitCode} signal=${d.signal} timedOut=${d.timedOut}, totalBytes=${d.totalBytes} retainedBytes=${d.retainedBytes} omittedBytes=${d.omittedBytes}\n${d.output}`).join('\n') || message);
  return { kind: 'preparation-diagnostic' as const, id: randomUUID(), message, output };
}
export function preparationDiagnosticTool() {
  return defineSessionTool({
    name: 'read_preparation_diagnostic', kind: 'read-diagnostic', readOnly: true, destructive: false,
    description: 'Read a retained, redacted preparation diagnostic page from this session. Offsets count Unicode characters. Masking never changes executed source.',
    inputSchema: z.object({ id: z.string().uuid(), offset: z.number().int().nonnegative().default(0) }).strict(),
    async execute({id, offset}, ctx) {
      for (const event of [...(ctx.readEvents?.() ?? [])].reverse()) {
        if (event.type !== 'tool-result' || event.toolName !== 'verify_preparations') continue;
        const result = EvidenceSchema.safeParse(event.artifact);
        if (!result.success || result.data.id !== id) continue;
        const chars = Array.from(result.data.output);
        if (offset > chars.length) return { isError: true, content: 'Offset is beyond diagnostic end.' };
        const page = chars.slice(offset, offset + 8000).join('');
        return { content: JSON.stringify({ id, offset, nextOffset: offset + 8000 < chars.length ? offset + 8000 : null, totalCharacters: chars.length, text: page }) };
      }
      return { isError: true, content: 'Diagnostic is unavailable in this session or its explicit resume parent.' };
    },
  });
}
