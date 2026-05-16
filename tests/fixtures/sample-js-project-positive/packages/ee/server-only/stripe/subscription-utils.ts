
// Pass-through: catch(error) passes error to console.error and returns null
async function fetchSubscriptionRecord(customerId: string): Promise<SubscriptionRecord | null> {
  try {
    return await getSubscriptionByCustomerId(customerId);
  } catch (error) {
    console.error(error);
    return null;
  }
}

interface SubscriptionRecord { id: string; status: string; customerId: string; }
declare function getSubscriptionByCustomerId(id: string): Promise<SubscriptionRecord>;
