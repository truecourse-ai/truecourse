/**
 * Idiomatic boolean-context guards on string and boolean values. The
 * loose-boolean-expression rule must NOT fire here:
 *
 *   - `if (str)` where str is `string | undefined` — empty string `''`
 *     and `undefined` are equivalent in business logic ("not present").
 *     This is the dominant pattern for optional string parameters and
 *     web-API headers/values.
 *   - `if (bool)` where bool is `boolean | undefined` — `false` and
 *     `undefined` are equivalent in business logic ("not set"); the
 *     developer is checking for the truthy case.
 *
 * Mirrors documenso's
 *   apps/openpage-api/lib/cors.ts:76 `if (allowed)` on string
 *   apps/docs/src/app/docs/layout.tsx:47 `if (url) return url` on string|undefined
 *   …/direct-template-signing-form.tsx:184 `if (meta?.success)` on boolean|undefined
 *
 * The rule must continue to fire on numeric guards, where `0` is a
 * silent falsy value with different semantics than "absent" — that
 * negative case lives in the queue-worker fixture.
 */

export function setAllowHeader(req: { readonly allowedHeader?: string }, target: Map<string, string>): void {
  // string|undefined guard — empty-string and undefined behave the same.
  const allowed = req.allowedHeader;
  if (allowed) {
    target.set('Access-Control-Allow-Headers', allowed);
  }
}

export function pickFirstUrl(candidates: readonly { readonly url: string | undefined }[]): string | undefined {
  for (const c of candidates) {
    const url = c.url;
    if (url) return url;
  }
  return undefined;
}

export function reportSuccess(meta: { readonly success: boolean | undefined }): string {
  // boolean|undefined guard — false and undefined behave the same here.
  if (meta.success) return 'ok';
  return 'pending';
}

export function applyTitle(title: string | null): string {
  // string|null guard.
  if (title) return title;
  return 'Untitled';
}
