/**
 * How a run and its sessions PRESENT themselves — declarative, JSON-safe data
 * a session definition (or the run process) declares and the shell stamps into
 * the record at emit time, so the record is self-describing and its reader
 * needs no per-kind knowledge. Never functions: this travels through jsonl and
 * over the wire.
 *
 * ONE vocabulary at both levels: the same blocks ride a session's `outcome`
 * event and a run record's own `display`, so the client renders blocks by kind
 * and holds no structure of its own — the run's phase checklist is itself a
 * block (`checklist`) the run process declares.
 *
 * The `DisplayBlock` vocabulary is APPEND-ONLY, and readers PARSE IT
 * TOLERANTLY: `DisplayBlockSchema` accepts any object carrying a `kind`, so a
 * block this reader has never heard of — or a known kind whose fields are
 * malformed — degrades where it renders and never invalidates the record that
 * carries it. A run record is the whole run's memory; one strange block must
 * not be able to make it unreadable. Writers hold themselves to
 * `KnownDisplayBlockSchema`, which is strict.
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
 * One line of a checklist block. `key` is the stable id its writer updates in
 * place across rewrites; `sessionKinds` is the item's own claim of which
 * session kinds did its work, so no reader needs a phase-to-kind table.
 */
export const ChecklistItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: z.enum(['pending', 'active', 'done', 'error']),
  detail: z.string().optional(),
  sessionKinds: z.array(z.string()).optional(),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

/**
 * One rendered piece of a record, as WRITERS state it. Presentation shapes,
 * not domain shapes — any workstream reuses them. See the append-only rule in
 * the module header.
 */
export const KnownDisplayBlockSchema = z.discriminatedUnion('kind', [
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
  /** Steps of a piece of work, each carrying where it got to. */
  z.object({ kind: z.literal('checklist'), items: z.array(ChecklistItemSchema) }),
]);
export type KnownDisplayBlock = z.infer<typeof KnownDisplayBlockSchema>;

/**
 * A block whose kind postdates this reader — or whose known kind arrived
 * malformed. Kept whole (`passthrough`), so a reader that cannot render it
 * still states what it carries and a rewrite does not silently drop it.
 */
export const UnknownDisplayBlockSchema = z.object({ kind: z.string() }).passthrough();

/**
 * One rendered piece of a record, as READERS take it: known first, anything
 * else preserved verbatim. `z.union` tries members in order, so a well-formed
 * block parses to its declared shape and everything else survives as-is.
 */
export const DisplayBlockSchema = z.union([KnownDisplayBlockSchema, UnknownDisplayBlockSchema]);
export type DisplayBlock = z.infer<typeof DisplayBlockSchema>;

/** The presented form of a record — a session's outcome, or a run itself. */
export const DisplayBlocksSchema = z.object({ blocks: z.array(DisplayBlockSchema) });
export type DisplayBlocks = z.infer<typeof DisplayBlocksSchema>;
