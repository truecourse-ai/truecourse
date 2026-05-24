// Strict-mode tsconfig (the project root) has `useUnknownInCatchVariables: true`
// implicitly. The compiler already types `e` as `unknown`, so requiring an
// explicit `: unknown` annotation here would be redundant noise.

class DomainError extends Error {}

function performStep(): void {
  throw new DomainError('boom');
}

export function runJob(): string {
  try {
    performStep();
    return 'ok';
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }
    return 'failed';
  }
}

export function parseJsonOrDefault<T>(input: string, fallback: T): T | unknown {
  try {
    return JSON.parse(input);
  } catch (err) {
    return fallback;
  }
}
