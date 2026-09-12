import { z } from 'zod';
import { RunRecordSchema, SessionEventSchema, SessionProgressSchema } from '@truecourse/agent-loop';
import type { UIMessage } from 'ai';

/** A public snapshot never carries the live session API's credential. */
export const ActivityRunSchema = RunRecordSchema.transform(({ endpoint: _endpoint, pid: _pid, ...run }) => run);
export type ActivityRun = z.infer<typeof ActivityRunSchema>;

/** Opaque monotonic cursor scoped to a run: a database sequence or legacy byte offset. */
export const ActivityEventSchema = z.discriminatedUnion('kind', [
  z.object({ cursor: z.number().int().nonnegative(), kind: z.literal('run'), run: ActivityRunSchema }),
  z.object({
    cursor: z.number().int().nonnegative(), kind: z.literal('session-event'),
    sessionId: z.string(), event: SessionEventSchema,
  }),
]);
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

/** Conversation readers need every transcript event, but only the newest run
 * snapshot. Keep its original cursor so paging and live replay still agree. */
export function compactRunSnapshots(events: readonly ActivityEvent[]): ActivityEvent[] {
  let latest = -1;
  for (const event of events) if (event.kind === 'run') latest = Math.max(latest, event.cursor);
  return events.filter(event => event.kind !== 'run' || event.cursor === latest);
}

export type ActivityEventBody = ActivityEvent extends infer E
  ? E extends ActivityEvent ? Omit<E, 'cursor'> : never : never;

export type ActivityMessage = UIMessage<never, {
  activity: ActivityEvent;
  progress: ActivityProgress;
  heartbeat: { at: string };
}>;

export const ActivityProgressSchema = z.record(SessionProgressSchema);
export type ActivityProgress = z.infer<typeof ActivityProgressSchema>;
