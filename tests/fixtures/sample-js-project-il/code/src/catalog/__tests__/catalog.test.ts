// FP-GUARD: auth-requirement/unprotected — must NOT drift
// Paraphrase: MSW mock handlers in test files have no auth middleware.
// The extractor must exclude test files so test mocks don't masquerade
// as real route implementations — triggering false unprotected drifts
// for routes that are actually auth-protected in real code.

import { http, HttpResponse } from 'msw';

// This handler mimics the pattern from the upstream case: a test-file
// mock for a route that is auth-protected in real code.  Without test-file
// exclusion, the extractor sees this mock, finds no auth middleware on
// the containing file, and fires a spurious unprotected drift.
export const catalogTestHandlers = [
  http.get('/internal/catalog/:id', () => {
    return HttpResponse.json({ id: '1', name: 'Item' });
  }),
];
