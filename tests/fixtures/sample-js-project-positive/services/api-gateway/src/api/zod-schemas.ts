// Canonical-library-namespace shape from documenso, e.g.
// apps/remix/app/components/dialogs/document-resend-dialog.tsx:30 —
// `import * as z from 'zod'` is the designed API surface for Zod; users
// chain `z.object`, `z.string()`, `z.enum(...)` etc. through the namespace.
//
// The star-import visitor flags this because:
//   * source 'zod' is not in the idiomatic-namespace skip list (only
//     react, react-dom, @radix-ui/*, @headlessui/*, recharts, d3, three,
//     pixi.* are skipped),
//   * the import is not relative ('./' / '../'),
//   * `z` is used as a property accessor (z.object, z.string), never as a
//     JSX prefix (<z.Component ...>), so the JSX-prefix skip doesn't apply.

import * as z from 'zod';
import * as _superjson from 'superjson';

export const ZRecipientSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1).max(120),
  role: z.enum(['SIGNER', 'VIEWER', 'CC']),
});

export const ZEnvelopeRequestSchema = z.object({
  title: z.string().min(1).max(200),
  recipients: z.array(ZRecipientSchema).min(1).max(50),
  message: z.string().max(2000).optional(),
});

export type EnvelopeRequest = z.infer<typeof ZEnvelopeRequestSchema>;

export function serializeEnvelope(env: EnvelopeRequest): string {
  return _superjson.stringify(env);
}

export function deserializeEnvelope(payload: string): EnvelopeRequest {
  return _superjson.parse(payload) as EnvelopeRequest;
}
