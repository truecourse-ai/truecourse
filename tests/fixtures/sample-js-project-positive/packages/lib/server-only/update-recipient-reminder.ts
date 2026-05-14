declare function updateRecipientReminderDate(recipientId: string, nextDate: Date): Promise<void>;
declare function scheduleReminderNotification(recipientId: string, nextDate: Date): Promise<void>;

export async function updateRecipientNextReminder(recipientId: string, nextDate: Date) {
  await Promise.all([
    updateRecipientReminderDate(recipientId, nextDate),
    scheduleReminderNotification(recipientId, nextDate),
  ]);
}
