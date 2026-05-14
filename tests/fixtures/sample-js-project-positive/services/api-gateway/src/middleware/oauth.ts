
// HTTP 302 in c.redirect() is the standard Found/redirect status code
declare const c: { redirect(url: string, status: number): Response };
declare function onAuthorize(opts: { userId: string }, ctx: unknown): Promise<void>;
declare const existingAccount: { user: { id: string } } | null;
declare const orgUrl: string;

async function handleOAuthOrgLogin(ctx: unknown): Promise<Response | null> {
  if (existingAccount) {
    await onAuthorize({ userId: existingAccount.user.id }, ctx);
    return c.redirect(`/o/${orgUrl}`, 302);
  }
  return null;
}
