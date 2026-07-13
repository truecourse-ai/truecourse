import type { z } from 'zod';
import { ApiError } from './errors.js';

/** Validate a request body against a schema, or throw `422 validation_failed`. */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new ApiError(422, 'validation_failed', 'Invalid request body', {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

/** Read a string query param, treating empty/missing as undefined. */
export function qStr(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Read a UTC ISO-8601 date query param (ADR 0003), or undefined. */
export function qDate(value: unknown): Date | undefined {
  return typeof value === 'string' && value.length > 0 ? new Date(value) : undefined;
}
