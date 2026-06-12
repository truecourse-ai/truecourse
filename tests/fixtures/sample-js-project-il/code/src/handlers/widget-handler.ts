// FP-GUARD: operation/response-status — must NOT drift
// Paraphrase of the pattern where a route handler returns HttpResponse.json()
// (MSW / web-api style) without an explicit status argument. The extractor
// must recognise HttpResponse.json() as an implicit-200 response, matching
// the same rule it applies to Response.json() and NextResponse.json().

import { http, HttpResponse } from 'msw';

// FP-GUARD: enum/missing-value — must NOT drift
// Widget visibility includes the explicit "null" literal for widgets that
// haven't been assigned a visibility yet. The spec-side `WidgetVisibility`
// enum carries the same three values; the comparator's substring guard must
// reject the spurious cross-match against the unrelated `visibility` field
// of TaskInputSchema (see handlers/task-handler.ts) — a long entity prefix
// ("Widget", 6 chars) before "visibility" signals different domains.
export type WidgetVisibility = 'public' | 'private' | 'null';

// MSW-style handler: HttpResponse.json() defaults to 200 — same contract
// as Response.json() which the extractor already recognises.
export const widgetHandlers = [
  http.get('/v1/widgets/:id', () => {
    return HttpResponse.json({ id: '1', name: 'Widget', visibility: 'public' as WidgetVisibility });
  }),
];

// The handler below emits a genuine non-200 response — regression guard.
// IL-DRIFT: Operation:GET /v1/broken-widgets/{id} / response.200
export const brokenWidgetHandlers = [
  http.get('/v1/broken-widgets/:id', () => {
    return new HttpResponse(null, { status: 404 });
  }),
];
