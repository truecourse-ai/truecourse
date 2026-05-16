declare const db: {
  $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
};
declare function upsertField(tx: unknown, fieldId: string, value: string): Promise<void>;

export async function updateEnvelopeFields(envelopeId: string, fields: Array<{ id: string; value: string }>) {
  return db.$transaction(async (tx) => {
    await Promise.all(
      fields.map((field) => upsertField(tx, field.id, field.value)),
    );
  });
}
