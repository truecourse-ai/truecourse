import { z } from 'zod';

// FP-GUARD: enum/missing-value — WidgetVisibility must NOT drift
// WidgetVisibility has an explicit TypeScript type with all correct values including 'null'.
// It must not collide onto the `visibility` field inside TaskInputSchema (a different entity).
// Before the fix, `widgetvisibility` contains `visibility` as a substring, causing the
// comparator to match WidgetVisibility to the wrong Zod field and fire a false missing-value.
export type WidgetVisibility = 'public' | 'private' | 'null';

// Task entity uses a Zod schema with a `visibility` field (missing 'null').
// TaskVisibility.missing-value.null is the genuine TP here — see regression file.
export const TaskInputSchema = z
  .object({
    visibility: z.enum(['public', 'private']),
  })
  .partial();
