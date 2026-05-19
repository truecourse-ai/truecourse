/**
 * Paraphrased FP from documenso/documenso for
 * bugs/deterministic/array-callback-return.
 *
 * Same shape as the sibling FP (#116) but exercising the
 * `Promise.all(arr.map(async ...))` idiom in a different setting — a webhook
 * trigger loop. The async callback's return value is always a Promise; a
 * missing explicit `return` is not a missing-result bug.
 */

interface WebhookSubscriber {
  id: string;
  endpoint: string;
}

interface WebhookClient {
  fire(subscriber: WebhookSubscriber, payload: Record<string, unknown>): Promise<void>;
}

export async function triggerWebhooks(
  subscribers: readonly WebhookSubscriber[],
  client: WebhookClient,
  payload: Record<string, unknown>,
): Promise<void> {
  await Promise.allSettled(
    subscribers.map(async (subscriber) => {
      await client.fire(subscriber, payload);
    }),
  );
}

export async function sealDocuments(
  envelopeIds: readonly string[],
  sealOne: (id: string) => Promise<void>,
): Promise<void> {
  await Promise.allSettled(
    envelopeIds.map(async (envelopeId) => {
      await sealOne(envelopeId);
    }),
  );
}
