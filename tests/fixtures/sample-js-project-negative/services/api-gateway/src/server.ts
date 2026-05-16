/**
 * Server bootstrap — missing body size limit.
 */
import express from 'express';

// VIOLATION: architecture/deterministic/missing-request-body-size-limit
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

export { app };

// Timezone registry side-effect import followed immediately by named imports from the same module.
declare module './constants/time-zones' {
  export const DEFAULT_API_TIME_ZONE: string;
  export const SUPPORTED_TIME_ZONES: string[];
}

import './constants/time-zones';
// VIOLATION: bugs/deterministic/duplicate-import
import { DEFAULT_API_TIME_ZONE, SUPPORTED_TIME_ZONES } from './constants/time-zones';

function resolveRequestTimeZone(headerValue: string | undefined): string {
  if (headerValue && SUPPORTED_TIME_ZONES.includes(headerValue)) {
    return headerValue;
  }
  return DEFAULT_API_TIME_ZONE;
}

export { resolveRequestTimeZone };
