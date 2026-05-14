
declare const db: { subscriber: { create: (args: { data: Record<string, unknown> }) => Promise<{ id: string; email: string }> } };
declare const sendWelcomeEmail: (subscriber: { id: string; email: string }) => Promise<void>;
declare const subscribers: Array<{ email: string; name: string; listId: string }>;

async function bulkSubscribeAndNotify() {
  await Promise.all(
    subscribers.map(async (subscriber) =>
      db.subscriber.create({
        data: {
          email: subscriber.email,
          name: subscriber.name,
          listId: subscriber.listId,
        },
      }),
    ),
  );
}



declare const jobs: { triggerJob: (opts: { name: string; payload: Record<string, unknown> }) => Promise<void> };
declare const pendingContacts: Array<{ id: string; email: string; role: string }>;
declare const documentId: string;
declare const userId: string;

async function notifyPendingContacts() {
  await Promise.all(
    pendingContacts.map(async (contact) => {
      await jobs.triggerJob({
        name: 'send.contact.notification.email',
        payload: {
          userId,
          documentId,
          contactId: contact.id,
        },
      });
    }),
  );
}
