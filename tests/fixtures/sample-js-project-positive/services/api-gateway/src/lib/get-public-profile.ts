
declare const prisma35: {
  workspace: {
    findFirst: (opts: unknown) => Promise<{
      id: string;
      name: string;
      url: string;
      avatarImageId: string | null;
      createdAt: Date;
      profile: { id: string; enabled: boolean; bio: string | null; workspaceId: string } | null;
      envelopes: Array<{ id: string; publicTitle: string | null; publicDescription: string | null; templateType: string; directLink: { enabled: boolean; token: string } | null }>;
    } | null>;
  };
};
declare const AppError35: new (code: string, opts: { message: string }) => Error;
declare const AppErrorCode35: { NOT_FOUND: string };
declare const EnvelopeType35: { TEMPLATE: string };
declare const TemplateType35: { PUBLIC: string };

type GetPublicWorkspaceProfileOptions35 = { profileUrl: string };

type PublicWorkspaceTemplate35 = {
  id: string;
  publicTitle: string | null;
  publicDescription: string | null;
  directLink: { enabled: boolean; token: string };
};

type GetPublicWorkspaceProfileResponse35 = {
  url: string;
  name: string;
  avatarImageId?: string | null;
  badge?: { type: 'Premium' | 'EarlyAdopter'; since: Date };
  templates: PublicWorkspaceTemplate35[];
  profile: { id: string; enabled: boolean; bio: string | null; workspaceId: string };
};

export const getPublicWorkspaceProfile35 = async ({
  profileUrl,
}: GetPublicWorkspaceProfileOptions35): Promise<GetPublicWorkspaceProfileResponse35> => {
  const workspace = await prisma35.workspace.findFirst({
    where: { url: profileUrl, profile: { enabled: true } } as unknown,
    include: {
      profile: true,
      envelopes: {
        where: {
          type: EnvelopeType35.TEMPLATE,
          templateType: TemplateType35.PUBLIC,
          directLink: { enabled: true },
        } as unknown,
        include: { directLink: true } as unknown,
      },
    } as unknown,
  });

  if (!workspace?.profile?.enabled) {
    throw new AppError35(AppErrorCode35.NOT_FOUND, { message: 'Profile not found' });
  }

  const templates = workspace.envelopes
    .filter((e) => e.directLink?.enabled && e.templateType === TemplateType35.PUBLIC)
    .map((e) => ({
      id: e.id,
      publicTitle: e.publicTitle,
      publicDescription: e.publicDescription,
      directLink: e.directLink!,
    }));

  return {
    badge: { type: 'Premium', since: workspace.createdAt },
    profile: workspace.profile,
    url: profileUrl,
    avatarImageId: workspace.avatarImageId,
    name: workspace.name || '',
    templates,
  };
};
