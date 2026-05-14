
declare const crypto: { createHash: (algo: string) => { update: (data: string) => { digest: (enc: string) => string } } };
declare const fields: Array<{ id: string; type: string; page: number; width: number; height: number }>;

function computeFieldsEtag() {
  const payload = JSON.stringify(
    fields.map((field) => ({
      id: field.id,
      type: field.type,
      page: field.page,
    }))
  );
  return crypto.createHash('sha256').update(payload).digest('hex');
}
