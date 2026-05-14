declare const io: {
  runTask<T>(name: string, fn: () => Promise<T>): Promise<T>;
};
declare function renderCancellationEmail(recipientId: string): Promise<string>;
declare function sendEmail(to: string, html: string): Promise<void>;

export async function run(payload: { recipients: Array<{ id: string; email: string }> }) {
  await io.runTask('send-cancellation-emails', async () => {
    await Promise.all(
      payload.recipients.map(async (r) => {
        const html = await renderCancellationEmail(r.id);
        await sendEmail(r.email, html);
      }),
    );
  });
}



declare function renderWithI18n(templateId: string, locale: string, vars: Record<string, string>): Promise<string>;
declare function sendEmail(to: string, html: string): Promise<void>;

export async function run2(payload: { recipients: Array<{ email: string; name: string }>; locale: string }) {
  const rendered = await Promise.all(
    payload.recipients.map((r) =>
      renderWithI18n('cancellation', payload.locale, { name: r.name }),
    ),
  );
  await Promise.all(
    payload.recipients.map((r, i) => sendEmail(r.email, rendered[i])),
  );
}
