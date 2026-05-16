
declare function renderEmailWithI18N(template: unknown, opts: { lang: string; branding: unknown; plainText?: boolean }): Promise<string>;
declare function getEmailContext(opts: { emailType: string; source: { type: string; teamId: string } }): Promise<{ branding: unknown; emailLanguage: string; senderEmail: string }>;
declare function getI18nInstance(lang: string): Promise<{ _: (msg: unknown) => string }>;
declare const mailer: { sendMail: (opts: { to: { name: string; address: string }; from: string; subject: string; html: string; text: string }) => Promise<void> };
declare function createElement(component: unknown, props: unknown): unknown;
declare const BatchCompleteEmail: unknown;
declare const NEXT_PUBLIC_WEBAPP_URL: () => string;

async function run(payload: { teamId: string; user: { name: string; email: string }; batchId: string; totalCount: number; successCount: number; failedCount: number }): Promise<void> {
  const { teamId, user, batchId, totalCount, successCount, failedCount } = payload;

  const completionTemplate = createElement(BatchCompleteEmail, {
    userName: user.name || user.email,
    batchId,
    totalCount,
    successCount,
    failedCount,
    assetBaseUrl: NEXT_PUBLIC_WEBAPP_URL(),
  });

  const { branding, emailLanguage, senderEmail } = await getEmailContext({
    emailType: 'INTERNAL',
    source: {
      type: 'team',
      teamId,
    },
  });

  const i18n = await getI18nInstance(emailLanguage);

  const [html, text] = await Promise.all([
    renderEmailWithI18N(completionTemplate, {
      lang: emailLanguage,
      branding,
    }),
    renderEmailWithI18N(completionTemplate, {
      lang: emailLanguage,
      branding,
      plainText: true,
    }),
  ]);

  await mailer.sendMail({
    to: {
      name: user.name || '',
      address: user.email,
    },
    from: senderEmail,
    subject: i18n._({ id: 'Batch {batchId} Complete' }),
    html,
    text,
  });
}



declare function renderPdfPage(opts: { pageIndex: number; fieldData: unknown }): Promise<Buffer>;
declare function getDocumentFields(documentId: string): Promise<{ id: string; pageNumber: number; data: unknown }[]>;

async function run2(payload: { documentId: string; certificateId: string }): Promise<void> {
  const { documentId, certificateId } = payload;

  const fields = await getDocumentFields(documentId);

  const pageGroups = fields.reduce<Record<number, typeof fields>>((acc, field) => {
    const group = acc[field.pageNumber] ?? [];
    group.push(field);
    acc[field.pageNumber] = group;
    return acc;
  }, {});

  const pageNumbers = Object.keys(pageGroups).map(Number);

  const renderedPages = await Promise.all(
    pageNumbers.map(async (pageIndex) => {
      return renderPdfPage({ pageIndex, fieldData: pageGroups[pageIndex] });
    }),
  );

  void renderedPages;
}



declare const io: { runTask: <T>(taskId: string, fn: () => Promise<T>) => Promise<T> };
declare function renderMemberLeftHtml(opts: { lang: string; branding: unknown; memberName: string; orgName: string }): Promise<string>;
declare function renderMemberLeftText(opts: { lang: string; branding: unknown; memberName: string; orgName: string }): Promise<string>;
declare function getOrgEmailContext(orgId: string): Promise<{ lang: string; branding: unknown; senderEmail: string }>;
declare const mailer2: { sendMail: (opts: unknown) => Promise<void> };

async function run3(payload: { orgId: string; memberName: string; orgName: string; ownerEmail: string }): Promise<void> {
  const { orgId, memberName, orgName, ownerEmail } = payload;

  const { lang, branding, senderEmail } = await getOrgEmailContext(orgId);

  await io.runTask('send-member-left-email', async () => {
    const [html, text] = await Promise.all([
      renderMemberLeftHtml({ lang, branding, memberName, orgName }),
      renderMemberLeftText({ lang, branding, memberName, orgName }),
    ]);

    await mailer2.sendMail({
      to: ownerEmail,
      from: senderEmail,
      subject: `${memberName} has left ${orgName}`,
      html,
      text,
    });
  });
}



declare const io2: { runTask: <T>(taskId: string, fn: () => Promise<T>) => Promise<T> };
declare function renderExpiryHtml(opts: { lang: string; branding: unknown; recipientName: string; documentTitle: string }): Promise<string>;
declare function renderExpiryText(opts: { lang: string; branding: unknown; recipientName: string; documentTitle: string }): Promise<string>;
declare function getTeamEmailContext(teamId: string): Promise<{ lang: string; branding: unknown; senderEmail: string }>;
declare const mailer3: { sendMail: (opts: unknown) => Promise<void> };

async function run4(payload: { teamId: string; recipientEmail: string; recipientName: string; documentTitle: string }): Promise<void> {
  const { teamId, recipientEmail, recipientName, documentTitle } = payload;

  const { lang, branding, senderEmail } = await getTeamEmailContext(teamId);

  await io2.runTask('send-expiry-email', async () => {
    const [html, text] = await Promise.all([
      renderExpiryHtml({ lang, branding, recipientName, documentTitle }),
      renderExpiryText({ lang, branding, recipientName, documentTitle }),
    ]);

    await mailer3.sendMail({
      to: recipientEmail,
      from: senderEmail,
      subject: `Your signing link for "${documentTitle}" has expired`,
      html,
      text,
    });
  });
}



declare function renderWelcomeEmailHtml(opts: { lang: string; branding: unknown; recipientName: string; documentTitle: string }): Promise<string>;
declare function renderWelcomeEmailText(opts: { lang: string; branding: unknown; recipientName: string; documentTitle: string }): Promise<string>;
declare function getSourceEmailContext(sourceType: string; sourceId: string): Promise<{ lang: string; branding: unknown; senderEmail: string }>;
declare const mailer4: { sendMail: (opts: unknown) => Promise<void> };

async function run5(payload: { sourceType: string; sourceId: string; recipientEmail: string; recipientName: string; documentTitle: string }): Promise<void> {
  const { sourceType, sourceId, recipientEmail, recipientName, documentTitle } = payload;

  const { lang, branding, senderEmail } = await getSourceEmailContext(sourceType, sourceId);

  const [html, text] = await Promise.all([
    renderWelcomeEmailHtml({ lang, branding, recipientName, documentTitle }),
    renderWelcomeEmailText({ lang, branding, recipientName, documentTitle }),
  ]);

  await mailer4.sendMail({
    to: recipientEmail,
    from: senderEmail,
    subject: `You have a document to sign: "${documentTitle}"`,
    html,
    text,
  });
}



declare function renderAccountLinkHtml(opts: { lang: string; branding: unknown; userName: string; confirmUrl: string }): Promise<string>;
declare function renderAccountLinkText(opts: { lang: string; branding: unknown; userName: string; confirmUrl: string }): Promise<string>;
declare function getOrgAccountEmailContext(orgId: string): Promise<{ lang: string; branding: unknown; senderEmail: string }>;
declare const mailer5: { sendMail: (opts: unknown) => Promise<void> };

export async function sendAccountLinkConfirmationEmail(opts: { orgId: string; recipientEmail: string; userName: string; confirmUrl: string }): Promise<void> {
  const { orgId, recipientEmail, userName, confirmUrl } = opts;

  const { lang, branding, senderEmail } = await getOrgAccountEmailContext(orgId);

  const [html, text] = await Promise.all([
    renderAccountLinkHtml({ lang, branding, userName, confirmUrl }),
    renderAccountLinkText({ lang, branding, userName, confirmUrl }),
  ]);

  await mailer5.sendMail({
    to: recipientEmail,
    from: senderEmail,
    subject: 'Confirm your account link',
    html,
    text,
  });
}



declare function renderSigningInviteHtml(opts: { lang: string; branding: unknown; signerName: string; documentTitle: string; signingUrl: string }): Promise<string>;
declare function renderSigningInviteText(opts: { lang: string; branding: unknown; signerName: string; documentTitle: string; signingUrl: string }): Promise<string>;
declare function getSigningEmailContext(sourceType: string; sourceId: string): Promise<{ lang: string; branding: unknown; senderEmail: string }>;
declare const mailer6: { sendMail: (opts: unknown) => Promise<void> };

async function run6(payload: { sourceType: string; sourceId: string; signerEmail: string; signerName: string; documentTitle: string; signingUrl: string }): Promise<void> {
  const { sourceType, sourceId, signerEmail, signerName, documentTitle, signingUrl } = payload;

  const { lang, branding, senderEmail } = await getSigningEmailContext(sourceType, sourceId);

  const [html, text] = await Promise.all([
    renderSigningInviteHtml({ lang, branding, signerName, documentTitle, signingUrl }),
    renderSigningInviteText({ lang, branding, signerName, documentTitle, signingUrl }),
  ]);

  await mailer6.sendMail({
    to: signerEmail,
    from: senderEmail,
    subject: `Please sign: "${documentTitle}"`,
    html,
    text,
  });
}



declare function renderCertificateSection(opts: { sectionType: string; data: unknown }): Promise<Buffer>;
declare function getCertificateSections(certificateId: string): Promise<{ sectionType: string; data: unknown }[]>;
declare function assembleCertificate(sections: Buffer[], certificateId: string): Promise<Buffer>;

export async function generateSigningCertificate(certificateId: string): Promise<Buffer> {
  const sections = await getCertificateSections(certificateId);

  const renderedSections = await Promise.all(
    sections.map(async (section) => {
      return renderCertificateSection({ sectionType: section.sectionType, data: section.data });
    }),
  );

  return assembleCertificate(renderedSections, certificateId);
}
