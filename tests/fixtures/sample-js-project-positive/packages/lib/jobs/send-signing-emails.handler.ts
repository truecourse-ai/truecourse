declare const io: {
  runTask<T>(name: string, fn: () => Promise<T>): Promise<T>;
};
declare function renderSigningEmail(recipientId: string, locale: string): Promise<string>;
declare function deliverEmail(to: string, html: string): Promise<void>;

export async function run(payload: { recipients: Array<{ id: string; email: string }>; locale: string }) {
  await io.runTask('send-signing-emails', async () => {
    const htmlBodies = await Promise.all(
      payload.recipients.map((r) => renderSigningEmail(r.id, payload.locale)),
    );
    await Promise.all(
      payload.recipients.map((r, i) => deliverEmail(r.email, htmlBodies[i])),
    );
  });
}
