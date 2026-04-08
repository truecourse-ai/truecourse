/**
 * Notifications utility -- manages notification state.
 */

interface Notification {
  id: string;
  title: string;
  read: boolean;
}

export function createNotifications(userId: string): Notification[] {
  return [
    { id: '1', title: `Welcome ${userId}`, read: false },
  ];
}

export function markAsRead(notifications: readonly Notification[], id: string): Notification[] {
  return notifications.map((n) => n.id === id ? { ...n, read: true } : n);
}
