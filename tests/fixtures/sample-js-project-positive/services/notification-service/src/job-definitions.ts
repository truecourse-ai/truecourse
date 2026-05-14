
// --- shape ded5b80f4736: dynamic import() in job handler ---
declare function zEmail(): unknown;
declare const z: { object: (s: Record<string, unknown>) => unknown; boolean: () => { optional: () => unknown } };

const SEND_CONFIRMATION_EMAIL_JOB = {
  id: 'send.confirmation.email',
  name: 'Send Confirmation Email',
  version: '1.0.0',
  handler: async ({ payload }: { payload: { email: string; force?: boolean } }) => {
    const handler = await import('./send-confirmation-email.handler');
    await handler.run({ payload });
  },
};
