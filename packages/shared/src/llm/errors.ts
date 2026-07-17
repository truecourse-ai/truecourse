export class LlmSessionLimitError extends Error {
  readonly code = 'LLM_SESSION_LIMIT' as const;
  readonly statusCode = 429;

  constructor(readonly resetHint?: string) {
    super(
      resetHint
        ? `Claude session limit reached; resets ${resetHint}. Wait until the limit resets before retrying.`
        : 'Claude session limit reached. Wait until the limit resets before retrying.',
    );
    this.name = 'LlmSessionLimitError';
  }
}

interface ClaudeErrorEnvelope {
  is_error?: unknown;
  api_error_status?: unknown;
  result?: unknown;
}

const SESSION_LIMIT_PATTERN = /\byou(?:['’]ve)\s+hit\s+your\s+session\s+limit\b/i;
const RESET_HINT_PATTERN = /(?:^|[·—-]\s*|\s+)resets?\s+(.+?)\s*$/i;

function asClaudeEnvelope(value: unknown): ClaudeErrorEnvelope | null {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value.trim());
      return asClaudeEnvelope(parsed);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  return value as ClaudeErrorEnvelope;
}

/**
 * Recognize only the definite Claude session-limit response observed in real
 * analyze runs. A bare 429 is deliberately not enough: ordinary throttling
 * remains eligible for the caller's bounded retry policy.
 */
export function parseLlmSessionLimitError(value: unknown): LlmSessionLimitError | null {
  const envelope = asClaudeEnvelope(value);
  if (
    envelope?.is_error !== true ||
    Number(envelope.api_error_status) !== 429 ||
    typeof envelope.result !== 'string' ||
    !SESSION_LIMIT_PATTERN.test(envelope.result)
  ) {
    return null;
  }

  const resetHint = RESET_HINT_PATTERN.exec(envelope.result)?.[1];
  return new LlmSessionLimitError(resetHint);
}

export function isLlmSessionLimitError(value: unknown): value is LlmSessionLimitError {
  return (
    value instanceof LlmSessionLimitError ||
    (!!value &&
      typeof value === 'object' &&
      'code' in value &&
      (value as { code?: unknown }).code === 'LLM_SESSION_LIMIT')
  );
}
