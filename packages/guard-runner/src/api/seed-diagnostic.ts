import { StringDecoder } from 'node:string_decoder';

/** Output is retained by complete lines, so a retention edge never exposes a cut secret. */
export class SeedOutputCapture {
  private decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
  private partial = { stdout: '', stderr: '' };
  private dropping = { stdout: false, stderr: false };
  private lines: string[] = [];
  private size = 0;
  totalBytes = 0;
  omittedBytes = 0;
  static readonly limit = 1024 * 1024;
  static readonly lineLimit = 64 * 1024;
  push(stream: 'stdout' | 'stderr', chunk: Buffer) {
    this.totalBytes += chunk.length;
    this.consume(stream, this.decoders[stream].write(chunk));
  }
  private consume(stream: 'stdout' | 'stderr', text: string) {
    for (const part of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
      const ended = part.endsWith('\n');
      if (this.dropping[stream]) this.omittedBytes += Buffer.byteLength(part);
      else {
        this.partial[stream] += part;
        if (Buffer.byteLength(this.partial[stream]) > SeedOutputCapture.lineLimit) {
          this.omittedBytes += Buffer.byteLength(this.partial[stream]);
          this.partial[stream] = '';
          this.dropping[stream] = true;
        }
      }
      if (ended) {
        if (this.dropping[stream]) this.add('[oversized output line omitted]\n');
        else this.add(this.partial[stream]);
        this.partial[stream] = ''; this.dropping[stream] = false;
      }
    }
  }
  private add(line: string) {
    this.lines.push(line); this.size += Buffer.byteLength(line);
    // Retain a head and moving tail. Entire lines are removed, never partial secrets.
    while (this.size > SeedOutputCapture.limit && this.lines.length > 2) {
      const start = Math.min(64, Math.floor(this.lines.length / 2));
      const ordinary = this.lines.findIndex((line, i) => i >= start && i < this.lines.length - 64 && !/(error|failed|cannot|ERR_)/i.test(line));
      const index = ordinary < 0 ? start : ordinary;
      const removed = this.lines.splice(index, 1)[0];
      this.size -= Buffer.byteLength(removed); this.omittedBytes += Buffer.byteLength(removed);
    }
  }
  finish() {
    for (const stream of ['stdout', 'stderr'] as const) {
      this.consume(stream, this.decoders[stream].end());
      if (this.dropping[stream]) this.add('[oversized output line omitted]\n');
      else if (this.partial[stream]) this.add(this.partial[stream]);
      this.partial[stream] = ''; this.dropping[stream] = false;
    }
    return this.lines.join('');
  }
}

export interface SeedDiagnostic {
  version: 1;
  output: string;
  totalBytes: number;
  retainedBytes: number;
  omittedBytes: number;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
}

/** Include original errors before wrapper stacks, plus context at both ends. */
export function seedDiagnosticSummary(output: string): string {
  const lines = output.split('\n');
  const indexes = new Set<number>();
  for (let i = 0; i < Math.min(3, lines.length); i++) indexes.add(i);
  let errors = 0;
  for (let i = 0; i < lines.length && errors < 12; i++) {
    if (!/(?:error|failed|cannot|not supported|exception|ERR_)/i.test(lines[i])) continue;
    errors++;
    for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 2); j++) indexes.add(j);
  }
  for (let i = Math.max(0, lines.length - 6); i < lines.length; i++) indexes.add(i);
  return [...indexes].sort((a, b) => a - b).map(i => lines[i].slice(0, 1000)).join('\n').slice(0, 8000);
}
