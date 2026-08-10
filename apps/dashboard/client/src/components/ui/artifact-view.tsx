/**
 * THE TWO READINGS OF AN ARTIFACT-BACKED ENTITY.
 *
 * A guard entity whose truth is a file on disk — a test (its YAML), a flow, an
 * interface, a claim (their entries in the JSON stores) — is shown exactly two ways
 * and never more:
 *
 *   View   the structured page: the entity read, joined, and explained
 *   YAML / JSON   the stored artifact itself, verbatim and read-only
 *
 * One toggle serves every one of them, so a reader learns the switch once and
 * finds it in the same corner of every detail. The second button is LABELLED BY
 * FORMAT rather than "Raw": a reader who clicks "YAML" knows what will appear,
 * and a page that says JSON on a YAML file would be lying about the store.
 *
 * The mode is EPHEMERAL state — never a URL param. It is a way of looking at the
 * page, not a place, so it does not survive a reload or ride in a shared link;
 * every surface opens on View.
 *
 * The raw pane is READ-ONLY. Editing an artifact happens in the repo, in an
 * editor, under version control — a dashboard textarea over a committed file
 * would be a second source of truth.
 */

import { useState, type ReactNode } from 'react';

/** The two artifact formats the guard stores use — and the raw mode's label. */
export type ArtifactFormat = 'YAML' | 'JSON';

/** Which reading is on screen. The format IS the mode name, so there are two. */
export type ArtifactMode = 'View' | ArtifactFormat;

/**
 * The mono code-block class the raw pane and the guard detail panes share.
 *
 * Content is never re-wrapped: a wrapped log line, command or JSON body lies
 * about its shape, so the block keeps `whitespace-pre` and scrolls HORIZONTALLY
 * on its own — the one scroll a detail pane sanctions, because the pane itself
 * clips the x axis.
 *
 * `max-w-full` is what keeps that sideways scroll INSIDE the block: without it a
 * block laid out as a flex item takes its content's width and stretches the pane,
 * and the reader ends up scrolling the whole page sideways.
 */
export const ARTIFACT_PRE =
  'mt-1 max-w-full overflow-x-auto whitespace-pre rounded border border-border bg-muted/20 p-2 font-mono text-[11px] text-foreground';

/**
 * The mode pair as ephemeral state, opening on View. Every artifact-backed detail
 * calls this rather than declaring its own `useState` union, so "two modes,
 * defaulting to the page" is stated once.
 */
export function useArtifactMode(format: ArtifactFormat): {
  mode: ArtifactMode;
  setMode: (mode: ArtifactMode) => void;
  /** True while the stored artifact is on screen — what a body branches on. */
  raw: boolean;
} {
  const [mode, setMode] = useState<ArtifactMode>('View');
  return { mode, setMode, raw: mode === format };
}

/**
 * The switch itself — the editor idiom, in the detail header: read the page, or
 * read the file it came from.
 */
export function ArtifactModeSwitch({
  format,
  mode,
  onSelect,
  className = '',
}: {
  format: ArtifactFormat;
  mode: ArtifactMode;
  onSelect: (mode: ArtifactMode) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="View mode"
      className={`flex shrink-0 rounded border border-border ${className}`}
    >
      {(['View', format] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => onSelect(m)}
          className={`px-2 py-0.5 text-[10px] font-medium first:rounded-l last:rounded-r ${
            mode === m ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

/**
 * The stored artifact, verbatim. The block is STABLE across its own load — it
 * renders the moment the mode flips and holds a placeholder until the content
 * lands, so a reader never watches the pane appear twice.
 *
 * The whole file (or the whole entry) is shown: someone who switched here asked
 * for all of it, so there is no clamp and no expander — the pane's own scroll
 * carries the height.
 */
export function ArtifactRaw({
  content,
  label,
  fallback = 'Loading…',
}: {
  /** The artifact text; `null` while it is still being read. */
  content: string | null;
  /** What this artifact IS, for screen readers — "test source", "flow source". */
  label: string;
  /** Shown in place of content that is not there yet, or could not be read. */
  fallback?: ReactNode;
}) {
  return (
    <pre className={ARTIFACT_PRE} aria-label={label}>
      {content ?? fallback}
    </pre>
  );
}
