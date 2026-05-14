// getSharedTemplateById — thin-server FP shape
declare const prisma_sharedTpl: {
  envelope: {
    findFirst: (opts: unknown) => Promise<{
      id: number;
      templateType: string;
      visibility: string;
      teamId: number | null;
      team: { organisationId: string } | null;
      envelopeItems: Array<{ id: number; documentData: unknown; order: number }>;
      folder: unknown;
      documentMeta: unknown;
      user: { id: number; name: string | null; email: string };
      recipients: Array<{ id: number; name: string; email: string; role: string }>;
    } | null>;
  };
};
declare const AppError_sharedTpl: new (code: string, opts: { message: string }) => Error;
declare const AppErrorCode_sharedTpl: { NOT_FOUND: string; FORBIDDEN: string };
declare const getTeamById_sharedTpl: (opts: { teamId: number; userId: number }) => Promise<{ id: number; organisationId: string }>;
declare const getMemberRoles_sharedTpl: (opts: { teamId: number; reference: { type: string; id: number } }) => Promise<{ teamRole: string }>;
declare const TEAM_DOCUMENT_VISIBILITY_MAP_sharedTpl: Record<string, string[]>;
declare const buildEnvelopeIdQuery_sharedTpl: (id: unknown, type: string) => unknown;
declare const EnvelopeType_sharedTpl: { TEMPLATE: string };
declare const TemplateType_sharedTpl: { ORGANISATION: string };

type GetSharedTemplateByIdOptions = {
  id: { documentId?: number; secondaryId?: string };
  userId: number;
  teamId: number;
};

export const getSharedTemplateById = async ({ id, userId, teamId }: GetSharedTemplateByIdOptions) => {
  const [callerTeam, { teamRole }] = await Promise.all([
    getTeamById_sharedTpl({ teamId, userId }),
    getMemberRoles_sharedTpl({
      teamId,
      reference: { type: 'User', id: userId },
    }),
  ]);

  const template = await prisma_sharedTpl.envelope.findFirst({
    where: {
      ...buildEnvelopeIdQuery_sharedTpl(id, EnvelopeType_sharedTpl.TEMPLATE),
      templateType: TemplateType_sharedTpl.ORGANISATION,
      visibility: { in: TEAM_DOCUMENT_VISIBILITY_MAP_sharedTpl[teamRole] },
      team: { organisationId: callerTeam.organisationId },
    } as unknown as Parameters<typeof prisma_sharedTpl.envelope.findFirst>[0]['where'],
    include: {
      envelopeItems: {
        include: { documentData: true },
        orderBy: { order: 'asc' },
      },
      folder: true,
      documentMeta: true,
      user: { select: { id: true, name: true, email: true } },
      recipients: { orderBy: { id: 'asc' } },
    },
  } as unknown as Parameters<typeof prisma_sharedTpl.envelope.findFirst>[0]);

  if (!template) {
    throw new AppError_sharedTpl(AppErrorCode_sharedTpl.NOT_FOUND, {
      message: 'Shared template not found or not visible to your role',
    });
  }

  if (!template.team || template.team.organisationId !== callerTeam.organisationId) {
    throw new AppError_sharedTpl(AppErrorCode_sharedTpl.FORBIDDEN, {
      message: 'Template belongs to a different organisation',
    });
  }

  return template;
};
