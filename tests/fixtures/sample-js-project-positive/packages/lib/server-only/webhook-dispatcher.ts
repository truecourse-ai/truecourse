
// FP shape: Promise.allSettled with async map dispatching jobs; no type mismatch
declare const jobs: { enqueue: (payload: { type: string; data: unknown }) => Promise<void> };
declare const subscribers: Array<{ url: string; events: string[] }>;
declare const eventPayload: unknown;

async function notifySubscribers() {
  await Promise.allSettled(
    subscribers.map(async (sub) =>
      jobs.enqueue({ type: 'webhook.trigger', data: { url: sub.url, payload: eventPayload } })
    )
  );
}
