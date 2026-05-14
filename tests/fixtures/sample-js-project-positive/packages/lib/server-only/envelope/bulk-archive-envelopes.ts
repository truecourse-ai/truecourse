
// FP: Thin server function — line count inflated by type imports and Zod schema boilerplate
declare const authenticatedProcedure: { input: (s: unknown) => { output: (s: unknown) => { mutation: (fn: (args: { input: unknown; ctx: { teamId: number; user: { id: number } } }) => Promise<unknown>) => unknown } } };
declare const ZBulkArchiveEnvelopesRequestSchema: unknown;
declare const ZBulkArchiveEnvelopesResponseSchema: unknown;
declare const getMultipleEnvelopeWhereInput: (ids: string[], teamId: number) => unknown;
declare const buildTeamWhereQuery: (opts: { teamId: number; userId: number }) => unknown;
declare const prisma: { envelope: { updateMany: (args: unknown) => Promise<{ count: number }> } };
declare class AppError extends Error { constructor(code: string, opts?: { message?: string }) {} }
declare const AppErrorCode: { UNAUTHORIZED: string };
declare const TEAM_VISIBILITY_MAP: Record<string, string>;

export const bulkArchiveEnvelopesRoute = authenticatedProcedure
  .input(ZBulkArchiveEnvelopesRequestSchema)
  .output(ZBulkArchiveEnvelopesResponseSchema)
  .mutation(async ({ input, ctx }) => {
    const { teamId, user } = ctx;
    const { envelopeIds } = input as { envelopeIds: string[] };

    const teamQuery = buildTeamWhereQuery({ teamId, userId: user.id });

    if (!teamQuery) {
      throw new AppError(AppErrorCode.UNAUTHORIZED, {
        message: 'You do not have permission to archive these envelopes.',
      });
    }

    const whereInput = getMultipleEnvelopeWhereInput(envelopeIds, teamId);

    const result = await prisma.envelope.updateMany({
      where: whereInput as Record<string, unknown>,
      data: {
        archivedAt: new Date(),
      },
    });

    return { count: result.count };
  });
