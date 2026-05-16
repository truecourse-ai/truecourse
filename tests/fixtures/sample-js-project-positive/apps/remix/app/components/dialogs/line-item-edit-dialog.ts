
// Pass-through: catch(err) passes err directly to console.error
async function updateLineItemDetails(itemId: string, data: Record<string, unknown>): Promise<void> {
  try {
    await patchLineItem(itemId, data);
  } catch (err) {
    console.error(err);
  }
}

declare function patchLineItem(id: string, data: Record<string, unknown>): Promise<void>;
