declare const io: {
  runTask<T>(name: string, fn: () => Promise<T>): Promise<T>;
};
declare function renderMemberJoinedEmail(memberId: string, orgId: string, locale: string): Promise<string>;
declare function sendEmail(to: string, html: string): Promise<void>;

export async function run(payload: { orgAdminEmails: string[]; memberId: string; orgId: string; locale: string }) {
  await io.runTask('send-member-joined-emails', async () => {
    const htmlBodies = await Promise.all(
      payload.orgAdminEmails.map(() =>
        renderMemberJoinedEmail(payload.memberId, payload.orgId, payload.locale),
      ),
    );
    await Promise.all(
      payload.orgAdminEmails.map((email, i) => sendEmail(email, htmlBodies[i])),
    );
  });
}
