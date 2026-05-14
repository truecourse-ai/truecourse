
// FP: function with destructured options param — not a complex expression
interface ReminderConfig { intervalDays: number; maxReminders: number }

function calculateNextReminderDate({
  config,
  sentAt,
}: {
  config: ReminderConfig;
  sentAt: Date;
}): Date {
  const nextDate = new Date(sentAt);
  nextDate.setDate(nextDate.getDate() + config.intervalDays);
  return nextDate;
}
