// prisma.$transaction with nested async map via Promise.all
declare const prisma: {
  $transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>;
};

declare const linkedParticipants: Array<{
  id?: number;
  email: string;
  role: string;
  formId: string;
}>;

export async function persistParticipants() {
  const results = await prisma.$transaction(async (tx) => {
    return await Promise.all(
      linkedParticipants.map(async (participant) => {
        const upserted = await tx.participant.upsert({
          where: { id: participant.id ?? -1 },
          create: {
            email: participant.email,
            role: participant.role,
            formId: participant.formId,
          },
          update: {
            email: participant.email,
            role: participant.role,
          },
        });

        return upserted;
      }),
    );
  });

  return results;
}


// --- argument-type-mismatch FP: typed call spreading report + recipients + computed fields ---
// generateAuditPdf({ report, contacts: report.contacts, fields, ...opts }) — all properties typed.
interface AuditPdfParams {
  report: { id: string; title: string };
  contacts: Array<{ id: string; email: string; name: string }>;
  fields: Array<{ id: string; type: string }>;
  locale: string;
  pageWidth: number;
  pageHeight: number;
}
declare function generateAuditPdf(params: AuditPdfParams): Promise<Buffer>;
declare const report2: { id: string; title: string; contacts: Array<{ id: string; email: string; name: string }>; fields: Array<{ id: string; type: string }> };
declare const PDF_SIZE: { width: number; height: number };

export async function exportAuditPdf(locale: string): Promise<Buffer> {
  return generateAuditPdf({
    report: report2,
    contacts: report2.contacts,
    fields: report2.fields,
    locale,
    pageWidth: PDF_SIZE.width,
    pageHeight: PDF_SIZE.height,
  });
}

