/**
 * How a session PRESENTS itself — declarative, JSON-safe data a session
 * definition declares and the shell stamps into the transcript at emit time,
 * so the record is self-describing and its reader needs no per-kind knowledge.
 * Never functions: this travels through jsonl and over the wire.
 *
 * The `OutcomeBlock` vocabulary is APPEND-ONLY. A reader must render an
 * unknown kind as a plain fact line and never crash, so a client older than
 * the vocabulary that produced a transcript stays correct as it grows.
 */

import { z } from 'zod';

/**
 * One tool's wording, singular and plural. `{n}` in `many` is replaced with
 * the call count — a `many` form without it silently drops the count.
 */
export const ToolDisplaySchema = z.object({ one: z.string(), many: z.string() });
export type ToolDisplay = z.infer<typeof ToolDisplaySchema>;

/** What a session says about itself: its opening line and its tool wording. */
export const SessionDisplaySchema = z.object({
  intro: z.string().optional(),
  tools: z.record(ToolDisplaySchema).optional(),
});
export type SessionDisplay = z.infer<typeof SessionDisplaySchema>;

/**
 * Two documents that disagree, named precisely enough for a reader to offer a
 * resolution. `anchorA`/`anchorB` are section anchors, `null` when the dispute
 * is whole-document.
 */
export const DisplayDisputeSchema = z.object({
  docA: z.string(),
  anchorA: z.string().nullable(),
  quoteA: z.string().optional(),
  docB: z.string(),
  anchorB: z.string().nullable(),
  quoteB: z.string().optional(),
});
export type DisplayDispute = z.infer<typeof DisplayDisputeSchema>;

/**
 * One rendered piece of an outcome. Presentation shapes, not domain shapes —
 * any workstream reuses them. See the append-only rule in the module header.
 */
export const OutcomeBlockSchema = z.discriminatedUnion('kind', [
  /** Prose in the session's own voice. */
  z.object({ kind: z.literal('text'), text: z.string() }),
  /** Short statements of what happened, one per line. */
  z.object({ kind: z.literal('facts'), lines: z.array(z.string()) }),
  /** A result card: what disagrees, quoted, with an optional recommendation. */
  z.object({
    kind: z.literal('finding'),
    claim: z.string(),
    quotes: z.array(
      z.object({ doc: z.string(), heading: z.string().optional(), quote: z.string() }),
    ),
    recommendation: z
      .object({
        doc: z.string().optional(),
        rationale: z.string(),
        confidence: z.string().optional(),
      })
      .optional(),
    dispute: DisplayDisputeSchema.optional(),
  }),
]);
export type OutcomeBlock = z.infer<typeof OutcomeBlockSchema>;

/** The presented form of an outcome value. */
export const OutcomeDisplaySchema = z.object({ blocks: z.array(OutcomeBlockSchema) });
export type OutcomeDisplay = z.infer<typeof OutcomeDisplaySchema>;
