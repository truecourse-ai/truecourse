import './env.js';

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  // DATABASE_URL is optional — if not set, embedded PostgreSQL is used
  databaseUrl: process.env.DATABASE_URL || '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  llmProvider: process.env.LLM_PROVIDER || 'anthropic',
  llmModel: process.env.LLM_MODEL || '',
  // Claude Code CLI provider settings
  claudeCodeBinary: process.env.CLAUDE_CODE_BINARY || 'claude',
  claudeCodeModel: process.env.CLAUDE_CODE_MODEL || '',
  claudeCodeTimeoutMs: parseInt(process.env.CLAUDE_CODE_TIMEOUT_MS || '120000', 10),
  claudeCodeMaxRetries: parseInt(process.env.CLAUDE_CODE_MAX_RETRIES || '2', 10),
  langfuse: {
    publicKey: process.env.LANGFUSE_PUBLIC_KEY || '',
    secretKey: process.env.LANGFUSE_SECRET_KEY || '',
    baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
  },
} as const;
