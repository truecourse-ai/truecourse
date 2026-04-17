import './env.js';

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  llmProvider: 'claude-code' as const,
  // Claude Code CLI provider settings
  claudeCodeBinary: process.env.CLAUDE_CODE_BINARY || 'claude',
  claudeCodeModel: process.env.CLAUDE_CODE_MODEL || '',
  claudeCodeTimeoutMs: parseInt(process.env.CLAUDE_CODE_TIMEOUT_MS || '120000', 10),
  claudeCodeMaxRetries: parseInt(process.env.CLAUDE_CODE_MAX_RETRIES || '2', 10),
} as const;
