
// Wave-M34: recipient.items.map((item) => ({...})) building ORM create data — field properties correctly mapped
declare const sourceRecipient: {
  items: Array<{ type: string; page: number; positionX: number; positionY: number; width: number; height: number; customText: string }>;
};
declare const newEnvelopeId: string;
declare const itemIdMap: Record<string, string>;

const itemsCreateData = sourceRecipient.items.map((item) => ({
  envelopeId: newEnvelopeId,
  envelopeItemId: itemIdMap[item.type] ?? '',
  type: item.type,
  page: item.page,
  positionX: item.positionX,
  positionY: item.positionY,
  width: item.width,
  height: item.height,
  customText: '',
  inserted: false,
}));



// Shape: customData.find() with backwards-compat predicate — valid find with no type mismatch
declare const customAssets: Array<{ assetDataId: string; itemId?: string }>;
declare const templateItems: Array<{ id: string; assetDataId: string }>;

export function resolveCustomAsset(item: { id: string }): string | undefined {
  const found = customAssets.find((customAsset) => {
    if (customAsset.assetDataId && !customAsset.itemId) {
      return true;
    }
    return customAsset.itemId === item.id;
  });

  return found?.assetDataId;
}



// FP shape f9b8db8f6e8e: pMap over recipients creating DB records — no type mismatch
declare function pMap<T, R>(arr: T[], fn: (item: T) => Promise<R>): Promise<R[]>;
declare const prisma: {
  recipient: {
    create: (args: { data: object }) => Promise<{ id: string }>;
  };
};
declare const duplicatedWorkspace: { id: string };
declare const sourceWorkspace: { recipients: Array<{ email: string; name: string; role: string; signingOrder: number }> };
declare const includeRecipients: boolean;

async function duplicateWorkspaceRecipients() {
  if (includeRecipients) {
    await pMap(
      sourceWorkspace.recipients,
      async (recipient) =>
        prisma.recipient.create({
          data: {
            workspaceId: duplicatedWorkspace.id,
            email: recipient.email,
            name: recipient.name,
            role: recipient.role,
            signingOrder: recipient.signingOrder,
          },
        }),
    );
  }
}
