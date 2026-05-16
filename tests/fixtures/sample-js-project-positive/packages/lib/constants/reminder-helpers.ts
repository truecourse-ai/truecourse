
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

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;
