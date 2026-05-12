
// MODE: while-loop-bounded-by-wall-clock-time
// Cron-tick poller iterates schedule slots between `lastTickAt` and `now`. The
// loop terminates as soon as the next scheduled time exceeds wall-clock `now`,
// so the slot count is bounded by elapsed real time / cron interval — not by
// any user-controlled input. No max-size guard is needed because the
// termination condition is inherently bounded by the current moment in time.
declare const CronExpressionParser: {
  parse(expr: string, opts: { currentDate: Date }): { next(): { toDate(): Date } };
};
declare const cronJob: { schedule: string; lastTickAt: Date };

export function getDueCronSlots(): Date[] {
  const slots: Date[] = [];
  const now = new Date();
  const iterator = CronExpressionParser.parse(cronJob.schedule, {
    currentDate: cronJob.lastTickAt,
  });
  let next = iterator.next();
  while (next.toDate() <= now) {
    slots.push(next.toDate());
    next = iterator.next();
  }
  return slots;
}
