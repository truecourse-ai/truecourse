/**
 * Positive fixture for bugs/deterministic/array-callback-missing-return.
 *
 * The idiomatic Promise.allSettled(arr.map(async ...)) pattern: the
 * async callback's return value is a Promise regardless of whether the
 * body contains an explicit `return`, so a missing return is not a bug
 * — Promise.all/allSettled receives the Promise[] that the array of
 * async callbacks already produces.
 */

interface Recipient {
  id: string;
  sendStatus: 'PENDING' | 'SENT';
}

interface JobsClient {
  triggerJob(args: { name: string; payload: { recipientId: string } }): Promise<void>;
}

export async function expireRecipientsSweep(
  recipients: readonly Recipient[],
  jobs: JobsClient,
): Promise<void> {
  await Promise.allSettled(
    recipients.map(async (recipient) => {
      await jobs.triggerJob({
        name: 'internal.process-recipient-expired',
        payload: { recipientId: recipient.id },
      });
    }),
  );
}

export async function notifyRecipients(
  recipients: readonly Recipient[],
  send: (id: string) => Promise<void>,
): Promise<void> {
  await Promise.allSettled(
    recipients.map(async (recipient) => {
      if (recipient.sendStatus !== 'SENT') {
        return;
      }
      await send(recipient.id);
    }),
  );
}
