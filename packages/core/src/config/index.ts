import './env.js';
import { resolveClaudeBinary } from '@truecourse/shared';

function parsePositiveInt(envVar: string, raw: string | undefined, defaultValue: number): number {
  if (raw === undefined || raw === '') return defaultValue;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${envVar} must be a positive integer, got "${raw}"`);
  }
  return parsed;
}

export const config = {
  llmProvider: 'claude-code' as const,
  // Claude Code CLI provider settings. Binary resolution is centralized in
  // `resolveClaudeBinary` (@truecourse/shared) so every command, the LLM
  // provider, and the extraction runners agree on the same target.
  claudeCodeBinary: resolveClaudeBinary(),
  claudeCodeModel: process.env.CLAUDE_CODE_MODEL || '',
  claudeCodeTimeoutMs: parseInt(process.env.CLAUDE_CODE_TIMEOUT_MS || '120000', 10),
  claudeCodeMaxRetries: parseInt(process.env.CLAUDE_CODE_MAX_RETRIES || '2', 10),
  claudeCodeMaxConcurrency: parsePositiveInt(
    'CLAUDE_CODE_MAX_CONCURRENCY',
    process.env.CLAUDE_CODE_MAX_CONCURRENCY,
    10,
  ),
} as const;
