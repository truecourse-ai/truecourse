
// Sample/demo data strings in a webhook payload generator — not business constants requiring extraction.
declare const RecipientRole: { SIGNER: string; VIEWER: string };

export function generateWebhookSamplePayload() {
  return {
    event: 'document.completed',
    data: {
      id: 42,
      title: 'Sample Agreement',
      recipients: [
        {
          id: 1,
          email: 'recipient@example.com',
          name: 'Jane Doe',
          role: RecipientRole.SIGNER,
          signedAt: new Date().toISOString(),
        },
      ],
    },
  };
}



// Hono RPC typed route key accessed via bracket notation — a framework API pattern, not a magic string.
declare const honoClient: Record<string, Record<string, { $post: (args: unknown) => Promise<Response> }>>;

export async function signInWithEmailPassword(data: { email: string; password: string }) {
  const response = await honoClient['email-password']['authorize'].$post({ json: data });

  if (!response.ok) {
    throw new Error('Sign-in failed');
  }

  return response.json();
}



// Entity type prefix string passed to a prefixedId helper in seed data — a single-use type identifier.
declare function prefixedId(entityType: string): string;
declare const prisma: {
  envelope: {
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
  };
};

export async function seedTemplateRecord(teamId: number, userId: number) {
  return prisma.envelope.create({
    data: {
      id: prefixedId('envelope'),
      type: 'TEMPLATE',
      teamId,
      userId,
      title: '[TEST] Seed Template',
    },
  });
}



// type: 'documentId' is a discriminant in a typed union passed to a query builder — not a magic string.
declare function getEnvelopeWhereInput(opts: {
  id: { type: 'documentId'; id: number } | { type: 'envelopeId'; id: string };
  userId: number;
  teamId: number;
}): Promise<{ envelopeWhereInput: object }>;

export async function fetchDocumentForUser(documentId: number, userId: number, teamId: number) {
  const { envelopeWhereInput } = await getEnvelopeWhereInput({
    id: { type: 'documentId', id: documentId },
    userId,
    teamId,
  });
  return envelopeWhereInput;
}



// type: 'envelopeId' is a typed union discriminant for an identifier selector — not a magic string.
declare function getEnvelopeWhereInput(opts: {
  id: { type: 'envelopeId'; id: string } | { type: 'documentId'; id: number };
  userId: number;
  teamId: number | null;
}): Promise<{ envelopeWhereInput: object }>;

export async function fetchEnvelopeByExternalId(envelopeId: string, userId: number) {
  const { envelopeWhereInput } = await getEnvelopeWhereInput({
    id: { type: 'envelopeId', id: envelopeId },
    userId,
    teamId: null,
  });
  return envelopeWhereInput;
}



// Standard API response message string in a Stripe webhook handler — a single-use informational string.
declare function match<T>(value: T): {
  with: <P>(pattern: P, fn: () => Promise<Response>) => {
    with: <P2>(pattern: P2, fn: () => Promise<Response>) => { otherwise: (fn: () => Response) => Promise<Response> };
  };
};

declare function buildWebhookEvent(payload: string, sig: string, secret: string): { type: string };

export async function handlePaymentWebhook(payload: string, signature: string, secret: string) {
  const event = buildWebhookEvent(payload, signature, secret);

  return match(event.type)
    .with('payment_intent.succeeded', async () => {
      return Response.json({ success: true, message: 'Webhook received' }, { status: 200 });
    })
    .with('payment_intent.payment_failed', async () => {
      return Response.json({ success: true, message: 'Webhook received' }, { status: 200 });
    })
    .otherwise(() => Response.json({ success: false, message: 'Unhandled event' }, { status: 400 }));
}



// prefixedId('envelope') — 'envelope' is an entity type prefix for seed IDs, not a repeated business constant.
declare function prefixedId(entityType: string): string;
declare const prisma: {
  envelope: {
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
  };
};

export async function seedDocument(userId: number, teamId: number, key: string) {
  return prisma.envelope.create({
    data: {
      id: prefixedId('envelope'),
      type: 'DOCUMENT',
      title: `[TEST] Document ${key}`,
      userId,
      teamId,
    },
  });
}
