/**
 * Notification models — tests compound type annotations.
 *
 * Tests:
 * - Interface used as property type with union (X | null) — usedAsType FP
 * - Interface used via extends — usedAsType via inheritance
 */

export interface NotificationChannel {
  name: string;
  enabled: boolean;
}

export interface NotificationPriority {
  level: number;
  label: string;
}

export interface BaseNotification {
  title: string;
  body: string;
}

export interface Notification extends BaseNotification {
  channel: NotificationChannel | null;
  priority: NotificationPriority | undefined;
  recipients: string[];
}
