declare function renderRejectionEmail(recipientId: string, locale: string): Promise<string>;
declare function sendEmail(to: string, html: string): Promise<void>;

export async function run(payload: { recipients: Array<{ id: string; email: string }>; locale: string }) {
  await Promise.all(
    payload.recipients.map(async (r) => {
      const html = await renderRejectionEmail(r.id, payload.locale);
      await sendEmail(r.email, html);
    }),
  );
}
