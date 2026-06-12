// FP-GUARD: operation/implementation-missing — must NOT drift
// Outbound delivery calls the partner notification API at
// https://api.partner.io/notifications/{id}. That URL is declared in
// the spec but lives on an external service — this module enqueues
// delivery payloads; it does not implement the remote endpoint.
export default { id: 'transform', handle: (_payload: unknown) => null };
