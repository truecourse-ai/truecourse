
// shape: tRPC query procedure is async but delegates to getOrganisations returning a Promise; async for tRPC procedure handler signature conformance
declare function getOrganisations(opts: { userId: string }): Promise<unknown[]>;
declare const authenticatedProcedure: { input(s: unknown): { output(s: unknown): { query(handler: (opts: { ctx: { user: { id: string } } }) => Promise<unknown>): unknown } } };
declare const ZGetOrgsInputSchema: unknown;
declare const ZGetOrgsOutputSchema: unknown;

const getOrgsRoute = authenticatedProcedure
  .input(ZGetOrgsInputSchema)
  .output(ZGetOrgsOutputSchema)
  .query(async ({ ctx }) => {
    const { user } = ctx;
    return getOrganisations({ userId: user.id });
  });



declare const AppError: { parseError: (e: unknown) => { code: string } };
declare const AppErrorCode: { CONFLICT: string };
declare function updateOrganisation(orgId: string, data: Record<string, unknown>): Promise<void>;
declare function showToast(opts: { title: string; description: string; variant?: string }): void;

async function handleOrgUpdate(orgId: string, data: Record<string, unknown>): Promise<void> {
  try {
    await updateOrganisation(orgId, data);
    showToast({ title: 'Organisation updated', description: 'Settings saved successfully.' });
  } catch (err) {
    const error = AppError.parseError(err);
    showToast({
      title: 'Error',
      description: error.code === AppErrorCode.CONFLICT ? 'Name already in use.' : 'An unknown error occurred.',
      variant: 'destructive',
    });
  }
}



declare function updateOrgMemberRole(orgId: string, memberId: string, role: string): Promise<void>;
declare function showToast(opts: { title: string; description: string; variant?: string }): void;
declare function closeDialog(): void;

async function handleMemberRoleUpdate(orgId: string, memberId: string, role: string): Promise<void> {
  try {
    await updateOrgMemberRole(orgId, memberId, role);
    closeDialog();
    showToast({ title: 'Role updated', description: 'Member role has been updated.' });
  } catch (err) {
    console.error(err);
    showToast({
      title: 'Update failed',
      description: 'An error occurred while updating the member role.',
      variant: 'destructive',
    });
  }
}



declare function inviteOrgMember(orgId: string, email: string, role: string): Promise<void>;
declare function showToast(opts: { title: string; description: string; variant?: string }): void;
declare function closeDialog(): void;

async function handleMemberInvite(orgId: string, email: string, role: string): Promise<void> {
  try {
    await inviteOrgMember(orgId, email, role);
    closeDialog();
    showToast({ title: 'Invite sent', description: `An invitation has been sent to ${email}.` });
  } catch (err) {
    console.error(err);
    showToast({
      title: 'Invite failed',
      description: 'An error occurred while sending the invitation.',
      variant: 'destructive',
    });
  }
}
