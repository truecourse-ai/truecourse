declare function renderConfirmationEmail(userId: string, locale: string): Promise<{ html: string; text: string }>;
declare function sendTransactionalEmail(to: string, subject: string, html: string, text: string): Promise<void>;
declare function recordEmailDelivery(userId: string, type: string): Promise<void>;

export async function sendConfirmationEmail(userId: string, email: string, locale: string) {
  const [rendered] = await Promise.all([
    renderConfirmationEmail(userId, locale),
    recordEmailDelivery(userId, 'confirmation'),
  ]);
  await sendTransactionalEmail(email, 'Confirm your account', rendered.html, rendered.text);
}
