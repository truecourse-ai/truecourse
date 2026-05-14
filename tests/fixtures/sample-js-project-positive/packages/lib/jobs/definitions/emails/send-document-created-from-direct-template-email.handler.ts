// sendContractFromTemplateEmail handler — thin-server FP shape
declare const mailer_templateEmail: { sendMail: (opts: { from: { name: string; address: string }; to: string; subject: string; html: string; text: string }) => Promise<void> };
declare const prisma_templateEmail: {
  envelope: {
    findFirst: (opts: unknown) => Promise<{
      id: number;
      title: string;
      teamId: number | null;
      recipients: Array<{ id: number; name: string; email: string; role: string }>;
      user: { id: number; email: string; name: string | null };
      team: { slug: string } | null;
      documentMeta: unknown;
    } | null>;
  };
};
declare const getEmailContext_tpl: (opts: { emailType: string; source: { type: string; teamId: number | null }; meta: unknown }) => Promise<{ branding: unknown; emailLanguage: string; senderEmail: { name: string; address: string } }>;
declare const renderEmailWithI18N_tpl: (template: unknown, opts: { lang: string; branding: unknown; plainText?: boolean }) => Promise<string>;
declare const getI18nInstance_tpl: (lang: string) => Promise<{ _(msg: unknown): string }>;
declare const createElement_tpl: (component: unknown, props: unknown) => unknown;
declare const ContractFromTemplateEmailTemplate_tpl: unknown;
declare const WEBAPP_BASE_URL_tpl: () => string;
declare const formatDocumentsPath_tpl: (teamSlug: string) => string;
declare const msg_tpl: (strings: TemplateStringsArray, ...args: unknown[]) => unknown;

type SendContractFromTemplateEmailPayload = { envelopeId: number; recipientId: number };

export const run_contractTemplate = async ({ payload }: { payload: SendContractFromTemplateEmailPayload }) => {
  const { envelopeId, recipientId } = payload;

  const envelope = await prisma_templateEmail.envelope.findFirst({
    where: { id: envelopeId },
    include: {
      recipients: { where: { id: recipientId } },
      user: { select: { id: true, email: true, name: true } },
      team: { select: { slug: true } },
      documentMeta: true,
    },
  } as unknown as Parameters<typeof prisma_templateEmail.envelope.findFirst>[0]);

  if (!envelope) {
    throw new Error('Envelope not found');
  }
  if (envelope.recipients.length === 0) {
    throw new Error('Recipient not found');
  }

  const [recipient] = envelope.recipients;
  const { user: templateOwner } = envelope;

  const { branding, emailLanguage, senderEmail } = await getEmailContext_tpl({
    emailType: 'INTERNAL',
    source: { type: 'team', teamId: envelope.teamId },
    meta: envelope.documentMeta,
  });

  const baseUrl = WEBAPP_BASE_URL_tpl() || 'http://localhost:3000';
  const documentLink = `${WEBAPP_BASE_URL_tpl()}${formatDocumentsPath_tpl(envelope.team?.slug ?? '')}/${envelope.id}`;

  const emailTemplate = createElement_tpl(ContractFromTemplateEmailTemplate_tpl, {
    recipientName: recipient.email,
    recipientRole: recipient.role,
    documentLink,
    documentName: envelope.title,
    assetBaseUrl: baseUrl,
  });

  const i18n = await getI18nInstance_tpl(emailLanguage);

  const [html, text] = await Promise.all([
    renderEmailWithI18N_tpl(emailTemplate, { lang: emailLanguage, branding }),
    renderEmailWithI18N_tpl(emailTemplate, { lang: emailLanguage, branding, plainText: true }),
  ]);

  const subject = i18n._(msg_tpl`A contract has been created for you to sign`);

  await mailer_templateEmail.sendMail({
    from: senderEmail,
    to: recipient.email,
    subject,
    html,
    text,
  });
};
