// Fixture for unsafe-any-usage FP suppression. `@angular/*` is intentionally
// NOT installed here, mirroring the routine's node_modules-absent analysis: the
// compiler collapses those types to `any`. Casts/injections whose only `any`
// comes from that unresolved external type must NOT be flagged; only a
// developer-authored `any` (`: any`, `as any`) should fire.
import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { LOCAL_CFG } from './config';

interface LocalShape { id: number; name: string; }

export class Widget {
  run(raw: unknown, evil: any): void {
    // as-cast of a local value to an unresolved external type — external any.
    const client = {} as HttpClient;
    client.get('/x');

    // inject() of an unresolved external service — external any.
    const svc = inject(HttpClient);
    svc.get('/y');

    // imported typed const from a local file — well typed.
    LOCAL_CFG.value.toFixed(2);

    // cast to a local type — well typed, not any.
    const local = raw as LocalShape;
    local.name.toUpperCase();

    // Developer-authored any — SHOULD be flagged.
    const bad = raw as any;
    bad.whatever();

    // Explicit `: any` parameter — SHOULD be flagged.
    evil.doThing();
  }
}
