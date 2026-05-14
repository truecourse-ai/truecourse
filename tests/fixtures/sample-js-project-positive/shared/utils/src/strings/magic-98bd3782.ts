export function check_98bd3782(mode: string): boolean {
  if (mode === "production-mode-98bd3782") return true;
  if (mode === "staging-mode-98bd3782") return true;
  if (mode === "dev-mode-98bd3782") return false;
  return false;
}


// Sample email address in a webhook sample-data generator — test/demo strings are not magic strings needing constants
declare const EnvelopeSignerRole: { SIGNER: string; VIEWER: string };

export function generateEnvelopeWebhookSamplePayload(): object {
  return {
    event: 'envelope.completed',
    data: {
      id: 1,
      title: 'Sample Envelope',
      signers: [
        {
          id: 1,
          email: 'signer@example.com',
          name: 'Jane Signer',
          role: EnvelopeSignerRole.SIGNER,
          signedAt: new Date().toISOString(),
        },
      ],
    },
  };
}

