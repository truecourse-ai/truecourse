// Catalog snapshot publishing — assembles an immutable snapshot of the
// current catalog so downstream consumers can pin a known-good version.
// The snapshot bytes are built locally here; the REST surface that exposes
// them is split between the OSS build and the hosted control plane.

export interface CatalogSnapshot {
  id: string;
  itemCount: number;
  createdAt: Date;
}

export function buildCatalogSnapshot(items: readonly unknown[]): CatalogSnapshot {
  return { id: `snap_${Date.now()}`, itemCount: items.length, createdAt: new Date() };
}

// FP-GUARD: operation/implementation-missing — must NOT drift
// The hosted control plane exposes a per-workspace publish endpoint,
// POST /[workspace]/publish_snapshot. That bracketed `[workspace]` segment
// is a relativized cloud-deployment URL — the spec lifted it from an
// absolute control-plane URL that carried the deployment scope in the path,
// dropping the host but keeping the `[workspace]` placeholder. The OSS build
// never serves a per-deployment route (those are routed by the hosted plane),
// so the verifier must treat this identity as out-of-scope rather than emit
// an implementation.missing drift.

// The bare OSS publish endpoint, POST /publish_snapshot, is documented in the
// spec but no route handler is registered for it in this build yet — a
// genuine missing implementation the verifier must still report.
// IL-DRIFT: Operation:POST /publish_snapshot / implementation.missing
