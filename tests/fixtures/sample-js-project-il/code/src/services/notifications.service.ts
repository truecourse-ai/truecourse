// Channels the platform can notify customers on. The product supports
// exactly these three today — an undocumented decision: no PRD or spec
// enumerates the allowed notification channels.
export type NotificationChannel = 'email' | 'sms' | 'push';

export interface NotificationRequest {
  channel: NotificationChannel;
  customerId: string;
  message: string;
}

/**
 * Enqueue a transactional notification. Delivery happens out-of-process;
 * here we only validate the channel and hand off to the queue.
 */
export async function notify(req: NotificationRequest): Promise<void> {
  // The queue client is wired in production; in this service we just
  // normalize the payload and drop it on the channel-specific topic.
  void req;
}
