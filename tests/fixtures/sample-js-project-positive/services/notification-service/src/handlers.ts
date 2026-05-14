declare const mailer: { sendMail: (opts: any) => Promise<void> };
declare const prisma: any;
declare const createElement: (component: any, props: any) => any;
declare const getI18nInstance: (lang: string) => Promise<{ _: (msg: any) => string }>;
declare const WEBAPP_URL: () => string;
declare const renderEmailWithI18N: (content: any, opts: any) => Promise<string>;
declare const getEmailContext: (opts: any) => Promise<{ branding: any; emailLanguage: string; senderEmail: string }>;
declare const TeamWelcomeEmailTemplate: any;
declare const msg: (strings: TemplateStringsArray, ...values: any[]) => any;

type TTeamMemberAddedPayload = {
  teamId: string;
  memberUserId: string;
  addedBy: string;
};

type JobRunIO = {
  runTask: (name: string, fn: () => Promise<void>) => Promise<void>;
};

export const run = async ({
  payload,
  io,
}: {
  payload: TTeamMemberAddedPayload;
  io: JobRunIO;
}) => {
  const team = await prisma.team.findFirstOrThrow({
    where: { id: payload.teamId },
    include: {
      members: {
        where: {
          role: { in: ['ADMIN', 'OWNER'] },
        },
        include: {
          user: {
            select: { id: true, email: true, name: true },
          },
        },
      },
    },
  });

  const newMember = await prisma.teamMember.findFirstOrThrow({
    where: { userId: payload.memberUserId, teamId: payload.teamId },
    include: {
      user: {
        select: { id: true, email: true, name: true },
      },
    },
  });

  const { branding, emailLanguage, senderEmail } = await getEmailContext({
    emailType: 'INTERNAL',
    source: { type: 'team', teamId: team.id },
  });

  for (const member of team.members) {
    if (member.id === newMember.id) {
      continue;
    }

    await io.runTask(`send-team-member-added-email--${newMember.id}_${member.id}`, async () => {
      const emailContent = createElement(TeamWelcomeEmailTemplate, {
        assetBaseUrl: WEBAPP_URL(),
        baseUrl: WEBAPP_URL(),
        memberName: newMember.user.name || '',
        memberEmail: newMember.user.email,
        teamName: team.name,
        addedBy: payload.addedBy,
      });

      const [html, text] = await Promise.all([
        renderEmailWithI18N(emailContent, { lang: emailLanguage, branding }),
        renderEmailWithI18N(emailContent, { lang: emailLanguage, branding, plainText: true }),
      ]);

      const i18n = await getI18nInstance(emailLanguage);

      await mailer.sendMail({
        to: member.user.email,
        from: senderEmail,
        subject: i18n._(msg`A new member has joined your team`),
        html,
        text,
      });
    });
  }
};
