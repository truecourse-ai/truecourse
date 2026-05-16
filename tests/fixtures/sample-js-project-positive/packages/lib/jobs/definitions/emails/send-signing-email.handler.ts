// run_sendInviteEmail — thin-server job handler FP shape
declare const mailer_invite: { sendMail: (opts: { from: { name: string; address: string }; to: string; replyTo?: { name: string; address: string }; subject: string; html: string; text: string }) => Promise<void> };
declare const ContractInviteEmailTemplate_invite: unknown;
declare const isRecipientEmailValidForSending_invite: (recipient: unknown) => boolean;
declare const prisma_invite: {
  user: { findFirstOrThrow: (opts: unknown) => Promise<{ id: number; email: string; name: string | null }> };
  envelope: { findFirstOrThrow: (opts: unknown) => Promise<{ id: number; title: string; status: string; teamId: number | null; documentMeta: unknown; team: { teamEmail: string | null; name: string } | null }> };
  recipient: { findFirstOrThrow: (opts: unknown) => Promise<{ id: number; name: string; email: string; token: string; role: string; sendStatus: string }> };
  documentAuditLog: { create: (opts: unknown) => Promise<void> };
  recipient: { update: (opts: unknown) => Promise<void> };
};
declare const RecipientRole_invite: { CC: string; VIEWER: string; SIGNER: string; APPROVER: string };
declare const SendStatus_invite: { SENT: string };
declare const DocumentSource_invite: { TEMPLATE: string };
declare const EnvelopeType_invite: { DOCUMENT: string };
declare const DocumentStatus_invite: { PENDING: string };
declare const OrganisationType_invite: { PERSONAL: string };
declare const RECIPIENT_ROLE_TO_EMAIL_TYPE_invite: Record<string, string>;
declare const RECIPIENT_ROLES_DESCRIPTION_invite: Record<string, string>;
declare const getEmailContext_invite: (opts: { emailType: string; source: { type: string; teamId: number | null }; meta: unknown }) => Promise<{ branding: unknown; emailLanguage: string; senderEmail: { name: string; address: string } }>;
declare const getI18nInstance_invite: (lang: string) => Promise<{ _(msg: unknown): string }>;
declare const extractDerivedContractEmailSettings_invite: (meta: unknown) => { recipientSigningRequest: boolean };
declare const createContractAuditLogData_invite: (opts: unknown) => unknown;
declare const CONTRACT_AUDIT_LOG_TYPE_invite: { DOCUMENT_SENT: string };
declare const renderEmailWithI18N_invite: (tpl: unknown, opts: { lang: string; branding: unknown; plainText?: boolean }) => Promise<string>;
declare const renderCustomEmailTemplate_invite: (tpl: unknown, vars: unknown) => string | null;
declare const unsafeBuildEnvelopeIdQuery_invite: (id: unknown, type: string) => unknown;
declare const updateRecipientNextReminder_invite: (opts: { recipientId: number; envelopeId: number }) => Promise<void>;
declare const createElement_invite: (component: unknown, props: unknown) => unknown;
declare const WEBAPP_BASE_URL_invite: () => string;
declare const msg_invite: (strings: TemplateStringsArray, ...args: unknown[]) => unknown;

type SendInviteEmailPayload = { userId: number; documentId: number; recipientId: number; requestMetadata?: unknown };
type JobIO = { logger: { info: (msg: string) => void } };

export const run_sendContractInviteEmail = async ({ payload, io }: { payload: SendInviteEmailPayload; io: JobIO }) => {
  const { userId, documentId, recipientId, requestMetadata } = payload;

  const [sender, envelope, recipient] = await Promise.all([
    prisma_invite.user.findFirstOrThrow({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    } as unknown as Parameters<typeof prisma_invite.user.findFirstOrThrow>[0]),
    prisma_invite.envelope.findFirstOrThrow({
      where: {
        ...unsafeBuildEnvelopeIdQuery_invite({ type: 'documentId', id: documentId }, EnvelopeType_invite.DOCUMENT),
        status: DocumentStatus_invite.PENDING,
      } as unknown as Parameters<typeof prisma_invite.envelope.findFirstOrThrow>[0]['where'],
      include: { documentMeta: true, team: { select: { teamEmail: true, name: true } } },
    } as unknown as Parameters<typeof prisma_invite.envelope.findFirstOrThrow>[0]),
    prisma_invite.recipient.findFirstOrThrow({
      where: { id: recipientId },
    } as unknown as Parameters<typeof prisma_invite.recipient.findFirstOrThrow>[0]),
  ]);

  if (recipient.role === RecipientRole_invite.CC) return;

  const { recipientSigningRequest } = extractDerivedContractEmailSettings_invite(envelope.documentMeta);
  if (!recipientSigningRequest) {
    await prisma_invite.recipient.update({
      where: { id: recipientId },
      data: { sendStatus: SendStatus_invite.SENT },
    } as unknown as Parameters<typeof prisma_invite.recipient.update>[0]);
    return;
  }

  if (!isRecipientEmailValidForSending_invite(recipient)) return;

  const { branding, emailLanguage, senderEmail } = await getEmailContext_invite({
    emailType: RECIPIENT_ROLE_TO_EMAIL_TYPE_invite[recipient.role] ?? 'INVITE',
    source: { type: 'team', teamId: envelope.teamId },
    meta: envelope.documentMeta,
  });

  const signingLink = `${WEBAPP_BASE_URL_invite()}/sign/${recipient.token}`;
  const assetBaseUrl = WEBAPP_BASE_URL_invite() || 'http://localhost:3000';

  const customMessage = renderCustomEmailTemplate_invite(envelope.documentMeta, {
    signer: { name: recipient.name, email: recipient.email },
    sender: { name: sender.name, email: sender.email },
    document: { name: envelope.title, link: signingLink },
  });

  const emailTemplate = createElement_invite(ContractInviteEmailTemplate_invite, {
    inviterName: sender.name,
    inviterEmail: sender.email,
    documentName: envelope.title,
    signingLink,
    assetBaseUrl,
    role: RECIPIENT_ROLES_DESCRIPTION_invite[recipient.role],
    selfSigner: sender.email === recipient.email,
    customEmailMessage: customMessage,
    teamName: envelope.team?.name,
    isDirectTemplate: false,
  });

  const i18n = await getI18nInstance_invite(emailLanguage);
  const subject = i18n._(msg_invite`You have been invited to sign a contract`);

  const [html, text] = await Promise.all([
    renderEmailWithI18N_invite(emailTemplate, { lang: emailLanguage, branding }),
    renderEmailWithI18N_invite(emailTemplate, { lang: emailLanguage, branding, plainText: true }),
  ]);

  await mailer_invite.sendMail({
    from: senderEmail,
    to: recipient.email,
    replyTo: envelope.team?.teamEmail ? { name: envelope.team.name, address: envelope.team.teamEmail } : undefined,
    subject,
    html,
    text,
  });

  await prisma_invite.recipient.update({
    where: { id: recipientId },
    data: { sendStatus: SendStatus_invite.SENT },
  } as unknown as Parameters<typeof prisma_invite.recipient.update>[0]);

  await updateRecipientNextReminder_invite({ recipientId, envelopeId: envelope.id });

  await prisma_invite.documentAuditLog.create({
    data: createContractAuditLogData_invite({
      envelopeId: envelope.id,
      type: CONTRACT_AUDIT_LOG_TYPE_invite.DOCUMENT_SENT,
      user: { name: sender.name, email: sender.email },
      data: { recipientEmail: recipient.email, recipientName: recipient.name, recipientRole: recipient.role },
      requestMetadata,
    }),
  } as unknown as Parameters<typeof prisma_invite.documentAuditLog.create>[0]);

  io.logger.info(`Invite email sent to ${recipient.email}`);
};
