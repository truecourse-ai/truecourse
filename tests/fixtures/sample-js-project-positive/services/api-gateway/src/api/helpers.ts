/**
 * API helpers -- sits in api/ directory but is NOT a route handler.
 */

import { Request } from 'express';

const MIN_TOKEN_LENGTH = 8;

export function requireAuth(req: Request): { userId: string; role: string } {
  const authHeader = req.headers.authorization;
  if (authHeader === undefined || authHeader.length < MIN_TOKEN_LENGTH) {
    throw new Error('Invalid authorization header');
  }
  return { userId: '1', role: 'admin' };
}

export function formatError(message: string, code: number = 400): { error: string; code: number } {
  return { error: message, code };
}



// --- permissive-cors: positive (no-violation) patterns ---
// Mirrors the documenso openpage-api/lib/cors.ts shape (headers.set + cors()),
// but with strict, non-wildcard origins so the deterministic detector should
// correctly not flag any of these patterns.

declare const headers: { set: (name: string, value: string) => void; append: (name: string, value: string) => void };
declare const cors: (options: { origin: string | string[]; credentials?: boolean }) => unknown;
declare const responseHeaders: { set: (name: string, value: string) => void };
declare const ctx: { res: { setHeader: (name: string, value: string) => void; header: (name: string, value: string) => void } };
declare const ALLOWED_DOMAIN: string;

// Mode: shape-2830c2fce4f1 -- headers.set with explicit allow-listed origin
// Same call shape as the openpage-api wildcard FP, but the value is the trusted
// dashboard origin -- detector requires headerValue === '*' to flag.
function applyPublicMetricsCors(): void {
  headers.set('Access-Control-Allow-Origin', 'https://dashboard.truecourse.dev');
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  headers.append('Vary', 'Origin');
}

// Same builder pattern but reading the origin from an env-derived constant.
function applyConfiguredCors(): void {
  responseHeaders.set('Access-Control-Allow-Origin', ALLOWED_DOMAIN);
  responseHeaders.set('Access-Control-Allow-Credentials', 'true');
}

// cors({ origin: <not '*'> }) -- detector only flags when origin literal is '*'.
const publicApiCors = cors({
  origin: 'https://api.truecourse.dev',
  credentials: false,
});

const multiOriginCors = cors({
  origin: ['https://app.truecourse.dev', 'https://admin.truecourse.dev'],
  credentials: true,
});

// Express-style res.header / setHeader with a concrete origin.
function setExpressCorsHeaders(): void {
  ctx.res.setHeader('Access-Control-Allow-Origin', 'https://docs.truecourse.dev');
  ctx.res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

void publicApiCors;
void multiOriginCors;
void applyPublicMetricsCors;
void applyConfiguredCors;
void setExpressCorsHeaders;
