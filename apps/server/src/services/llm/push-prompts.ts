/**
 * Push all prompt definitions to Langfuse.
 *
 * Usage:
 *   npx tsx apps/server/src/services/llm/push-prompts.ts
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../../../.env') });

import { Langfuse } from 'langfuse';
import { PROMPT_DEFINITIONS, type PromptName } from './prompts.js';

const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
const secretKey = process.env.LANGFUSE_SECRET_KEY;
const baseUrl = process.env.LANGFUSE_BASE_URL || 'http://localhost:3002';

if (!publicKey || !secretKey) {
  console.error('Missing LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY in .env');
  process.exit(1);
}

const langfuse = new Langfuse({ publicKey, secretKey, baseUrl });

async function pushPrompts() {
  for (const [name, def] of Object.entries(PROMPT_DEFINITIONS)) {
    try {
      await langfuse.createPrompt({
        name,
        prompt: def.prompt,
        labels: [...def.labels],
        type: 'text',
      });
      console.log(`Pushed: ${name}`);
    } catch (error) {
      console.error(
        `Failed to push ${name}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  await langfuse.flushAsync();
  await langfuse.shutdownAsync();
  console.log('Done.');
}

pushPrompts();
