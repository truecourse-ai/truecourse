// Task handler — assignment workflows for catalog operators.
//
// Tasks have their own visibility model (separate from widget visibility).
// The Zod schema below carries an inner `visibility` field whose values are
// the most common case; the standalone `taskVisibility` enum below mirrors
// it for use outside the create-task schema. The TaskVisibility spec lists
// three values including a "null" literal for unassigned tasks, but the
// code intentionally ships only public/private — when an operator omits
// visibility it defaults at the controller layer, never reaches the enum.
// That gap is real and is the regression we want the verifier to catch.
//
// IL-DRIFT: Enum:TaskVisibility / enum.TaskVisibility.missing-value.null

import { z } from 'zod';

// Standalone enum used by task list filters and assignment APIs. Same
// values as the inline schema field, lifted into its own binding so it
// can be re-used by handlers that want the union without the whole
// TaskInputSchema.
export const taskVisibility = z.enum(['public', 'private']);

// Create/update payload for the tasks API. The `visibility` field here is
// intentionally NOT the spec-side `WidgetVisibility` enum even though the
// substring `visibility` matches both names — the comparator's
// entity-collision guard must keep them separate.
export const TaskInputSchema = z
  .object({
    title: z.string(),
    visibility: z.enum(['public', 'private']),
    assignee: z.string().uuid().optional(),
  })
  .partial();

export type TaskInput = z.infer<typeof TaskInputSchema>;
