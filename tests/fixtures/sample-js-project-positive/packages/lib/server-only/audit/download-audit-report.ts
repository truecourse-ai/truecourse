// download-audit-report.ts — thin server adapter: validates input, calls service
// Line count inflated by type imports and schema boilerplate.

declare const z: {
  object: (shape: Record<string, unknown>) => ZodObject;
  string: () => ZodString;
  number: () => ZodNumber;
  enum: (values: string[]) => ZodEnum;
  optional: (schema: unknown) => ZodOptional;
};
declare class ZodObject { parse(input: unknown): unknown; safeParse(input: unknown): { success: boolean; data?: unknown; error?: unknown }; }
declare class ZodString { parse(input: unknown): string; }
declare class ZodNumber { parse(input: unknown): number; }
declare class ZodEnum { parse(input: unknown): string; }
declare class ZodOptional { parse(input: unknown): unknown; }

declare const prisma: {
  auditLog: {
    findMany: (opts: { where: Record<string, unknown>; include?: Record<string, unknown>; orderBy?: unknown }) => Promise<AuditLog[]>;
  };
};

type AuditLog = {
  id: number;
  action: string;
  resourceId: string;
  userId?: number;
  createdAt: Date;
  metadata?: Record<string, unknown>;
};

type DownloadAuditReportInput = {
  resourceId: string;
  format: 'pdf' | 'csv';
  startDate?: string;
  endDate?: string;
};

type DownloadAuditReportOutput = {
  data: Buffer;
  filename: string;
  contentType: string;
};

const ZDownloadAuditReportInputSchema = z.object({
  resourceId: z.string(),
  format: z.enum(['pdf', 'csv']),
  startDate: z.optional(z.string()),
  endDate: z.optional(z.string()),
});

declare function generateAuditPdf(logs: AuditLog[], resourceId: string): Promise<Buffer>;
declare function generateAuditCsv(logs: AuditLog[], resourceId: string): Promise<Buffer>;

export async function downloadAuditReport(input: unknown): Promise<DownloadAuditReportOutput> {
  const { resourceId, format, startDate, endDate } = ZDownloadAuditReportInputSchema.parse(input) as DownloadAuditReportInput;

  const where: Record<string, unknown> = { resourceId };

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) (where.createdAt as Record<string, unknown>).gte = new Date(startDate);
    if (endDate) (where.createdAt as Record<string, unknown>).lte = new Date(endDate);
  }

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'asc' } as unknown,
  });

  if (format === 'pdf') {
    const data = await generateAuditPdf(logs, resourceId);
    return {
      data,
      filename: `audit-report-${resourceId}.pdf`,
      contentType: 'application/pdf',
    };
  }

  const data = await generateAuditCsv(logs, resourceId);
  return {
    data,
    filename: `audit-report-${resourceId}.csv`,
    contentType: 'text/csv',
  };
}
