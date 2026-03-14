import './env.js';

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  // DATABASE_URL is optional — if not set, embedded PostgreSQL is used
  databaseUrl: process.env.DATABASE_URL || '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  llmProvider: process.env.LLM_PROVIDER || 'anthropic',
  langfuse: {
    publicKey: process.env.LANGFUSE_PUBLIC_KEY || '',
    secretKey: process.env.LANGFUSE_SECRET_KEY || '',
    baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
  },
} as const;
