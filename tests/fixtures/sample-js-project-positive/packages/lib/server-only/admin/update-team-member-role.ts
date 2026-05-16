
declare const AppError: any;
declare const AppErrorCode: any;
declare const ctx: { logger: { error: (opts: any) => void } };
declare const OrganisationMemberRole: any;

async function reassignTeamOwnership(teamId: string, userId: string, role: string, team: any) {
  if (role === 'OWNER') {
    const adminGroup = team.groups.find((g: any) => g.role === OrganisationMemberRole.ADMIN);

    if (!adminGroup) {
      ctx.logger.error({
        message: '[CRITICAL]: Missing internal group',
        teamId,
        userId,
        targetRole: 'ADMIN',
      });

      throw new AppError(AppErrorCode.UNKNOWN_ERROR, {
        message: 'Admin group not found',
      });
    }
  }
}
