/**
 * MAPPER DIAGNOSTICS — the general RUN-REPORTING shape for anything a mapping
 * noticed and did not (or could not) settle itself. A diagnostic is a statement
 * about THIS working tree at THIS moment: it goes stale the instant the tree
 * moves, so it rides run results (`MapInterfacesResult`, `guard/setup.json`'s
 * step record) and NEVER enters the interface catalog or any fingerprint — the
 * catalog schema forbids storing doc-vs-code discrepancies in interface data,
 * and this type is where those observations live instead.
 *
 * Two producers today:
 * - the cli UNION in `derive.ts` — every disagreement between the tree
 *   derivation and the probe ladder (the four `*-missing-*` kinds);
 * - the catalog MERGE in `@truecourse/guard-runner`'s store — an authored
 *   screen no derivation backs (`authored-place-not-derived`).
 *
 * The TYPE ITSELF lives in `@truecourse/shared` (this module re-exports it):
 * guard-runner is a producer too, and it cannot import this package — the
 * dependency edge runs the other way (`interface-mapper` → `guard-runner`).
 *
 * The cli kinds are consumed by the `guard-setup.reconcile-interfaces` session
 * (core's `services/guard-setup/reconcile-interfaces.ts`), whose fold applies
 * the session's resolutions back onto the in-memory catalog — by the STRUCTURED
 * identity (`command`/`flag`), never by parsing `subject` back apart.
 */

export type { MapperDiagnostic, MapperDiagnosticKind } from '@truecourse/shared'
