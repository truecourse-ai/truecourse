
declare const fs: { readFileSync: (path: string) => Buffer };
declare const path: { join: (...parts: string[]) => string };
declare const __dirname: string;

function loadTestPdfAsBase64(): string {
  return fs.readFileSync(path.join(__dirname, '../assets/sample.pdf')).toString('base64');
}



// --- FP shape: await-in-loop in e2e fixture file creating fields per-recipient sequentially ---
declare const db: { field: { create(opts: { data: object }): Promise<{ id: string }> } };
declare const recipientIds: string[];
declare const fieldTemplates: Array<{ type: string; label: string }>;

async function seedRecipientFields(): Promise<void> {
  for (let i = 0; i < recipientIds.length; i++) {
    const recipientId = recipientIds[i];
    for (const template of fieldTemplates) {
      await db.field.create({
        data: {
          recipientId,
          type: template.type,
          label: template.label,
        },
      });
    }
  }
}
