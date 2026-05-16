// Module is registered in packages/lib/jobs/client.ts and dynamically imported
// via import() inside the job handler callback — static graph misses dynamic imports

export const sendVerificationEmailJobDef = {
  id: 'send-verification-email',
  handler: async (payload: { userId: string; email: string; token: string }) => {
    const { renderVerificationTemplate } = await import('./templates/verification');
    const html = renderVerificationTemplate({ token: payload.token });
    await dispatchEmail({ to: payload.email, html, subject: 'Verify your email' });
  },
};

declare function dispatchEmail(opts: { to: string; html: string; subject: string }): Promise<void>;



// E23: dynamic import() — no type mismatch.
async function loadEmailHandler(templateName: string) {
  const handler = await import(`./handlers/${templateName}.handler`);
  return handler;
}

export async function dispatchWelcomeEmail() {
  const { sendWelcomeEmail } = await import('./send-welcome-email.handler');
  return sendWelcomeEmail;
}
