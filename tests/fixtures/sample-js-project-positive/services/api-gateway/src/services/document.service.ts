// --- too-many-lines FP: thin server adapter whose line count is inflated by
// nested query-select boilerplate and type imports (shape_sig 5d67d55c930d) ---

declare const db: {
  envelope: {
    findFirst(opts: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    }): Promise<{
      id: string;
      secondaryId: string;
      internalVersion: number;
      title: string;
      completedAt: Date | null;
      team: { url: string };
      attachments: Array<{
        id: string;
        label: string;
        order: number;
        dataId: string;
        envelopeId: string;
        data: { id: string; kind: string; raw: string; original: string } | null;
      }>;
      _count: { signers: number };
    } | null>;
  };
};

declare const StatusEnum: { COMPLETED: string };
declare const KindEnum: { PACKAGE: string };
declare function resolveSecondaryId(secondaryId: string): string;

export type GetPackageByTokenOptions = {
  token: string;
};

export const getPackageByToken = async ({ token }: GetPackageByTokenOptions) => {
  if (!token) {
    throw new Error('Missing token');
  }

  const result = await db.envelope.findFirst({
    where: {
      kind: KindEnum.PACKAGE,
      status: StatusEnum.COMPLETED,
      accessToken: token,
    },
    select: {
      id: true,
      secondaryId: true,
      internalVersion: true,
      title: true,
      completedAt: true,
      team: {
        select: {
          url: true,
        },
      },
      attachments: {
        select: {
          id: true,
          label: true,
          order: true,
          dataId: true,
          envelopeId: true,
          data: {
            select: {
              id: true,
              kind: true,
              raw: true,
              original: true,
            },
          },
        },
      },
      _count: {
        select: {
          signers: true,
        },
      },
    },
  });

  if (!result) {
    return null;
  }

  if (result.attachments.length === 0) {
    throw new Error('Completed envelope has no attachments');
  }

  const primaryData = result.attachments[0].data;

  if (!primaryData) {
    throw new Error('Missing attachment data');
  }

  return {
    id: resolveSecondaryId(result.secondaryId),
    internalVersion: result.internalVersion,
    title: result.title,
    completedAt: result.completedAt,
    attachments: result.attachments,
    signerCount: result._count.signers,
    teamUrl: result.team.url,
  };
};
