/**
 * Server bootstrap — missing body size limit.
 */
import express from 'express';

// VIOLATION: architecture/deterministic/missing-request-body-size-limit
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

export { app };
