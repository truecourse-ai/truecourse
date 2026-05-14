
// Idiomatic TypeScript typed-initialization pattern: the null initial value
// is never read — if parsing fails the function throws; otherwise the variable
// is reassigned and then used. The null initializer serves as a type
// annotation anchor for the conditional assignment.
type SubscriptionCreatePayload = { planId: string; userId: string; organisationName: string };
declare function parsePayload(raw: string): { success: true; data: SubscriptionCreatePayload } | { success: false };
declare function throwBadRequest(msg: string): never;
declare function provisionSubscription(data: SubscriptionCreatePayload): Promise<string>;

async function handleSubscriptionCreated(rawPayload: string): Promise<string> {
  let subscriptionCreateData: SubscriptionCreatePayload | null = null;

  const parseResult = parsePayload(rawPayload);

  if (!parseResult.success) {
    throwBadRequest('Invalid subscription create payload');
  }

  subscriptionCreateData = (parseResult as { success: true; data: SubscriptionCreatePayload }).data;

  return provisionSubscription(subscriptionCreateData);
}
