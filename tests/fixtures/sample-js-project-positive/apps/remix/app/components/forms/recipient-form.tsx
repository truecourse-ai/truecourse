
// FP shape fbda3127c6d4: splice + map to reorder signers with signingOrder update — no type mismatch
declare function canRecipientBeModified(id: string): boolean;

type Signer = { id: string; signingOrder: number; name: string; email: string };

function reorderSigners(
  signers: Signer[],
  sourceIndex: number,
  destinationIndex: number,
): Signer[] {
  const items = [...signers];
  const [reorderedSigner] = items.splice(sourceIndex, 1);

  let insertIndex = destinationIndex;
  while (insertIndex < items.length && !canRecipientBeModified(items[insertIndex].id)) {
    insertIndex++;
  }

  items.splice(insertIndex, 0, reorderedSigner);

  return items.map((signer, index) => ({
    ...signer,
    signingOrder: !canRecipientBeModified(signer.id) ? signer.signingOrder : index + 1,
  }));
}
