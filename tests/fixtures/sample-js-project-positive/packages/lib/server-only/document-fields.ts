
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>; field: { deleteMany: (args: any) => Promise<any> }; auditLog: { createMany: (args: any) => Promise<any> }; };
declare function buildAuditEntry(fieldId: number, type: string): object;

export async function removeStaleFields(fieldIds: number[], envelopeId: number): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.field.deleteMany({
      where: { id: { in: fieldIds } },
    });

    await tx.auditLog.createMany({
      data: fieldIds.map((id) => buildAuditEntry(id, 'FIELD_REMOVED')),
    });
  });
}


// fs.readFileSync(...).toString('base64') FP — fs/path undefined → TS2304 in range → rule fires
export const loadFieldTemplateAsBase64_ef3d7ddf = (templateName: string): string => {
  const templatePath = path.join(process.cwd(), 'field-templates', templateName);
  return fs.readFileSync(templatePath).toString('base64');
};

