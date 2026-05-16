
declare const TEMP_ITEM_PREFIX: string;
declare const pendingItems: Array<{ id: string; title: string; replaceIndex?: number }>;
declare const itemsToCreate: unknown[];
declare const itemsToUpdate: unknown[];

function classifyPendingItems() {
  pendingItems.forEach((item) => {
    const isNew = item.id.startsWith(TEMP_ITEM_PREFIX);
    if (!isNew) {
      itemsToUpdate.push(item);
    } else {
      itemsToCreate.push(item);
    }
  });
}
