
// --- redundant-type-argument FP: Array<X & Y> intersection type in generic arg ---
declare const z: { object(shape: Record<string, unknown>): unknown; string(): unknown; nativeEnum(e: object): unknown; infer: unknown };

interface Field { id: string; type: string; page: number }
interface Signature { id: string; signatureImageAsBase64?: string }
interface Recipient { id: string; name: string; email: string }

interface RecipientWithFields {
  recipient: Recipient & {
    fields: Array<Field & { signature: Signature | null }>;
  };
}

function RecipientItemTable({ recipient }: RecipientWithFields) {
  const fieldsWithSigs: Array<Field & { signature: Signature | null }> = recipient.fields;
  return (
    <table>
      <tbody>
        {fieldsWithSigs.map((f) => (
          <tr key={f.id}>
            <td>{f.type}</td>
            <td>{f.signature?.id ?? 'unsigned'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
