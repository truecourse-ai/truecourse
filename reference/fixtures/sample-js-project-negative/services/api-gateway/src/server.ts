/**
 * Server bootstrap — missing body size limit and missing process-level
 * unhandledRejection handler. A real process entry-point at this filename
 * (`server.ts`) is exactly what `unhandled-rejection-no-handler` is meant
 * to flag.
 */
import express from 'express';

// VIOLATION: reliability/deterministic/unhandled-rejection-no-handler
// VIOLATION: reliability/deterministic/uncaught-exception-no-handler
// VIOLATION: architecture/deterministic/missing-request-body-size-limit
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

export { app };
