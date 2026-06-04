// FP-GUARD: operation/response-status — must NOT drift
// Paraphrase of the pattern where a route handler returns HttpResponse.json()
// (MSW / web-api style) without an explicit status argument. The extractor
// must recognise HttpResponse.json() as an implicit-200 response, matching
// the same rule it applies to Response.json() and NextResponse.json().

import { http, HttpResponse } from 'msw';

// MSW-style handler: HttpResponse.json() defaults to 200 — same contract
// as Response.json() which the extractor already recognises.
export const widgetHandlers = [
  http.get('/v1/widgets/:id', () => {
    return HttpResponse.json({ id: '1', name: 'Widget' });
  }),
];

// The handler below emits a genuine non-200 response — regression guard.
// IL-DRIFT: Operation:GET /v1/broken-widgets/{id} / response.200
export const brokenWidgetHandlers = [
  http.get('/v1/broken-widgets/:id', () => {
    return new HttpResponse(null, { status: 404 });
  }),
];
