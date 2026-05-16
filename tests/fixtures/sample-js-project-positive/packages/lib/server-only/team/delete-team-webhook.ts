declare const mailer: { sendMail: (opts: { to: string; subject: string; html: string }) => Promise<void> };
declare const WEBAPP_URL: string;
declare const TEAM_MEMBER_ROLE_PERMISSIONS_MAP: Record<string, string[]>;
declare function buildTeamWhereQuery(opts: { teamId: number; userId: number; roles: string[] }): unknown;
declare function getI18nInstance(lang: string): Promise<{ _: (msg: string) => string }>;
declare function renderEmailWithI18N(template: unknown, opts: { lang: string }): Promise<string>;
declare function getEmailContext(opts: { emailType: string; source: { type: string; teamId: number } }): Promise<{ branding: unknown; emailLanguage: string; senderEmail: string }>;
declare const prisma: { teamWebhook: { findFirstOrThrow: (q: unknown) => Promise<{ id: number; url: string; createdByMemberId: number; member: { user: { email: string; name: string } } }>; delete: (q: unknown) => Promise<void> } };
declare class WebhookRemovedTemplate { constructor(props: { webhookUrl: string; teamName: string; userName: string; actionUrl: string }) {} }

export type DeleteTeamWebhookOptions = {
  userId: number;
  teamId: number;
  webhookId: number;
};

export const deleteTeamWebhook = async ({ userId, teamId, webhookId }: DeleteTeamWebhookOptions) => {
  const { branding, emailLanguage, senderEmail } = await getEmailContext({
    emailType: 'INTERNAL',
    source: { type: 'team', teamId },
  });

  const webhook = await prisma.teamWebhook.findFirstOrThrow({
    where: {
      id: webhookId,
      teamId,
      team: {
        teamGroups: {
          some: {
            organisationGroup: {
              organisationGroupMembers: {
                some: {
                  organisationMember: { userId },
                },
              },
            },
          },
        },
      },
    },
    include: {
      member: {
        include: { user: { select: { email: true, name: true } } },
      },
    },
  });

  await prisma.teamWebhook.delete({ where: { id: webhookId } });

  const i18n = await getI18nInstance(emailLanguage);

  const template = new WebhookRemovedTemplate({
    webhookUrl: webhook.url,
    teamName: 'Team',
    userName: webhook.member.user.name,
    actionUrl: `${WEBAPP_URL}/settings/webhooks`,
  });

  const html = await renderEmailWithI18N(template, { lang: emailLanguage });

  await mailer.sendMail({
    to: webhook.member.user.email,
    subject: i18n._('Webhook removed from your team'),
    html,
  });

  return { success: true };
};
