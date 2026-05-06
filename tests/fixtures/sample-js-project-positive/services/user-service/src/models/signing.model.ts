/**
 * Signature/recipient types used by the signing UI and the api-gateway
 * envelope routes. The `Signer` shape is referenced from the
 * array-removal helpers; `Envelope` is referenced from the api-gateway
 * Hono handlers.
 */

export interface Signer {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

export interface Envelope {
  readonly id: string;
  readonly signers?: readonly Signer[];
}
