import { describe, it } from 'vitest';

// The pre-0.4 integration tests in this file seeded PGlite rows directly and
// hit the HTTP routes end-to-end. The v0.4 file-based store replaces both the
// schema and the bound-DB middleware, so those tests no longer reflect the
// runtime. The route handlers are thin wrappers around analysis-store +
// analytics + flow services (all unit-tested elsewhere); a dedicated
// file-store integration test would need a seeded `LATEST.json` fixture plus
// its own Express app. Queued for a follow-up pass.

describe.skip('routes (integration) — pending file-store rewrite', () => {
  it('placeholder', () => {
    // no-op
  });
});
