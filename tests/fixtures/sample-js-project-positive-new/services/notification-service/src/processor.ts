import { logger } from '@sample/shared-utils';
interface Notification { id: string; status: 'pending' | 'sent'; }
export class NotificationProcessor {
  private readonly queue: Notification[] = [];
  enqueue(id: string): { id: string; status: string } {
    this.queue.push({ id, status: 'pending' });
    return { id, status: 'queued' };
  }
  getStatus(id: string): Notification | null {
    return this.queue.find((n) => n.id === id) ?? null;
  }
  process(): number {
    let sent = 0;
    for (const n of this.queue) { if (n.status === 'pending') { n.status = 'sent'; sent += 1; } }
    return sent;
  }
  getQueueLength(): number { return this.queue.length; }
}
export function logProcessing(count: number): void { logger.info(String(count)); }
