declare function insertEnvelopeItem(envelopeId: string, item: { name: string; value: string }): Promise<{ id: string }>;

export async function createEnvelopeItems(
  envelopeId: string,
  items: Array<{ name: string; value: string }>,
) {
  const created = await Promise.all(
    items.map((item) => insertEnvelopeItem(envelopeId, item)),
  );
  return created;
}
