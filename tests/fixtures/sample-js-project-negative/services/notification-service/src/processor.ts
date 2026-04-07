import { EmailTemplates } from './templates';
import { sendEmail } from './sender';

interface Notification {
  id: string;
  type: 'email' | 'sms' | 'push';
  recipient: string;
  subject?: string;
  body: string;
  status: 'pending' | 'sent' | 'failed';
  retryCount: number;
  createdAt: Date;
}

interface NotificationQueue {
  items: Notification[];
  maxRetries: number;
}

export class NotificationProcessor {
  // VIOLATION: code-quality/deterministic/mutable-private-member
  private queue: NotificationQueue = { items: [], maxRetries: 3 };
  private templates = new EmailTemplates();

  // VIOLATION: code-quality/deterministic/missing-return-type
  // VIOLATION: code-quality/deterministic/static-method-candidate
  async enqueue(data: { type: string; recipient: string; subject?: string; body: string }) {
    const notification: Notification = {
      id: Math.random().toString(36).substring(7),
      type: data.type as 'email' | 'sms' | 'push',
      recipient: data.recipient,
      subject: data.subject,
      body: data.body,
      status: 'pending',
      retryCount: 0,
      createdAt: new Date(),
    };
    this.queue.items.push(notification);
    return { id: notification.id, status: 'queued' };
  }

  // VIOLATION: code-quality/deterministic/missing-return-type
  // VIOLATION: code-quality/deterministic/static-method-candidate
  async getStatus(id: string) {
    return this.queue.items.find((n) => n.id === id) ?? null;
  }

  /**
   * Process all pending notifications sequentially.
   * This is intentionally sequential to demonstrate await-in-loop.
   */
  // VIOLATION: code-quality/deterministic/missing-return-type
  async processQueue() {
    const pending = this.queue.items.filter((n) => n.status === 'pending');

    for (const notification of pending) {
      // VIOLATION: bugs/deterministic/await-in-loop
      const success = await this.sendNotification(notification);
      if (success) {
        notification.status = 'sent';
      } else {
        notification.retryCount++;
        // VIOLATION: code-quality/deterministic/magic-number
        if (notification.retryCount >= 3) {
          notification.status = 'failed';
        }
      }
    }

    return {
      processed: pending.length,
      sent: pending.filter((n) => n.status === 'sent').length,
      failed: pending.filter((n) => n.status === 'failed').length,
    };
  }

  // VIOLATION: code-quality/deterministic/missing-return-type
  private async sendNotification(notification: Notification) {
    try {
      if (notification.type === 'email') {
        const html = this.templates.render(notification.subject ?? 'Notification', notification.body);
        await sendEmail(notification.recipient, notification.subject ?? 'Notification', html);
        return true;
      }

      if (notification.type === 'sms') {
        // VIOLATION: code-quality/deterministic/console-log
        console.log(`Sending SMS to ${notification.recipient}: ${notification.body}`);
        return true;
      }

      if (notification.type === 'push') {
        // VIOLATION: reliability/deterministic/floating-promise
        fetch('https://push-api.example.com/send', {
          method: 'POST',
          body: JSON.stringify({
            to: notification.recipient,
            message: notification.body,
          }),
        });
        return true;
      }

      return false;
    } catch (error) {
      // VIOLATION: bugs/deterministic/empty-catch
    }
  }

  /**
   * Retry failed notifications.
   */
  // VIOLATION: code-quality/deterministic/missing-return-type
  async retryFailed() {
    const failed = this.queue.items.filter(
      (n) => n.status === 'failed' && n.retryCount < this.queue.maxRetries,
    );

    for (const notification of failed) {
      notification.status = 'pending';
      // VIOLATION: bugs/deterministic/await-in-loop
      await this.sendNotification(notification);
    }
  }

  /**
   * Clean up old notifications.
   */
  // VIOLATION: code-quality/deterministic/missing-return-type
  // VIOLATION: code-quality/deterministic/static-method-candidate
  async cleanup(notifications: Notification[]) {
    const now = Date.now();
    // VIOLATION: code-quality/deterministic/magic-number
    const maxAge = 7 * 24 * 60 * 60 * 1000;
    return notifications.filter((n) => now - n.createdAt.getTime() < maxAge);
  }

  // VIOLATION: code-quality/deterministic/missing-return-type
  getQueueStats() {
    const total = this.queue.items.length;
    const pending = this.queue.items.filter((n) => n.status === 'pending').length;
    const sent = this.queue.items.filter((n) => n.status === 'sent').length;
    const failed = this.queue.items.filter((n) => n.status === 'failed').length;
    return { total, pending, sent, failed };
  }
}
