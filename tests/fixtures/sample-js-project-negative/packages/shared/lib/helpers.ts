/**
 * Library helpers — should not access process.env directly.
 */

// VIOLATION: code-quality/deterministic/env-in-library-code
const apiKey = process.env.API_KEY || '';

export function getApiKey(): string {
  return apiKey;
}

// VIOLATION: code-quality/deterministic/env-in-library-code
export function buildAuthHeader(): string {
  return `Bearer ${process.env.SESSION_TOKEN ?? ''}`;
}
