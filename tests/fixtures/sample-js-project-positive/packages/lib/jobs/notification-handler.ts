
// cc8bdf38f426: io.runTask with async callback creating email element
declare const io: { runTask<T>(name: string, fn: () => Promise<T>): Promise<T> };
declare function createElement(component: unknown, props: Record<string, unknown>): unknown;
declare const WelcomeEmailTemplate: unknown;
declare const recipientEmail: string;
declare function sendEmail(opts: { to: string; subject: string; html: unknown }): Promise<void>;

async function dispatchWelcomeEmail() {
  await io.runTask('send-welcome-email', async () => {
    const emailTemplate = createElement(WelcomeEmailTemplate, {
      recipientEmail,
      loginUrl: 'https://example.com/login',
    });
    await sendEmail({ to: recipientEmail, subject: 'Welcome!', html: emailTemplate });
  });
}
