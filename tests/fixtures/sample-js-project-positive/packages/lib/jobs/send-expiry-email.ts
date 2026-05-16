
// cf59fc15d011: io.runTask('name', async () => {...}) — string name + async callback
declare const io: { runTask<T>(name: string, fn: () => Promise<T>): Promise<T> };
declare function sendExpiryNotification(userId: string): Promise<void>;
declare const userId: string;

async function dispatchExpiryEmail() {
  await io.runTask('send-expiry-notification', async () => {
    await sendExpiryNotification(userId);
  });
}
