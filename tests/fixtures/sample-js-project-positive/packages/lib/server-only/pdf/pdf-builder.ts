
// FP shape f8dd85ec6e16: Promise.all of parallel async service calls — no type mismatch
declare function getOrgClaimByTeamId(opts: { teamId: string }): Promise<{ flags: Record<string, boolean> }>;
declare function getAuditLogs(opts: { resourceId: string }): Promise<Array<{ action: string; timestamp: Date }>>;
declare function loadTranslations(locale: string): Promise<Record<string, string>>;
declare function parseLocale(lang?: string): string;

async function generateReportPdf(opts: { teamId: string; resourceId: string; language?: string; pageWidth: number; pageHeight: number }) {
  const { teamId, resourceId, language, pageWidth, pageHeight } = opts;
  const locale = parseLocale(language);

  const [orgClaim, auditLogs, messages] = await Promise.all([
    getOrgClaimByTeamId({ teamId }),
    getAuditLogs({ resourceId }),
    loadTranslations(locale),
  ]);

  return { orgClaim, auditLogs, messages, pageWidth, pageHeight };
}



// FP shape f98dc849abcb: insertFormValues with Buffer.from(file) cast — no type mismatch
declare function getFileContent(data: object): Promise<Buffer>;
declare function insertFormValuesInPdf(opts: { pdf: Buffer; formValues: Record<string, string | number | boolean> }): Promise<Buffer>;
declare const workItem: { documentData: object; formValues: unknown; title: string };

async function injectWorkItemValues() {
  const file = await getFileContent(workItem.documentData);
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const prefilled = await insertFormValuesInPdf({
    pdf: Buffer.from(file),
    formValues: workItem.formValues as Record<string, string | number | boolean>,
  });

  let fileName = workItem.title;
  if (!workItem.title.endsWith('.pdf')) {
    fileName = `${workItem.title}.pdf`;
  }

  return { prefilled, fileName };
}
