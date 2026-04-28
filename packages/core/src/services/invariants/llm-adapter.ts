import type { LLMRunner } from '@truecourse/analyzer'
import type { LLMProvider } from '../llm/provider.js'

/**
 * Adapter exposing the centralized LLMProvider as the narrowed LLMRunner
 * surface that plugins consume. Keeps plugins decoupled from the rest of
 * the LLMProvider's task-specific methods.
 */
export function createLLMRunner(provider: LLMProvider): LLMRunner {
  return {
    run: ({ prompt, schema, label }) =>
      provider.runStructuredPrompt({ prompt, schema, label }),
  }
}
