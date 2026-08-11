/**
 * The VISUAL half of an evidence bundle, inside the evidence section: the per-step
 * screenshots a browser run took, in step order, and the session video after them.
 *
 * A web step spawns nothing — no exit code, no streams — so a picture is the only
 * record of what it did. It renders for a GREEN run exactly as for a red one:
 * visuals are evidence, not failure decoration.
 *
 * Additive by construction. A bundle with no visuals (every cli/api run, and every
 * run recorded before the web driver existed) renders NOTHING — the evidence section
 * is then the transcript alone, unchanged.
 *
 * A thumbnail opens the run's screenshots as ONE CAROUSEL, full size, in the app:
 * a browser run is a sequence, and reading it means stepping through it — back and
 * next, ← and →, Escape or a click outside to leave. The video is not in it: a
 * player is already its own full reading, and a control surface that scrubs does
 * not belong under arrow keys that step.
 */

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { GuardEvidenceVisual } from '@truecourse/shared';
import * as api from '@/lib/api';

/** What one visual is called on the page — its step, or the file when it names none. */
function visualLabel(visual: GuardEvidenceVisual): string {
  return visual.step != null ? `Step ${visual.step}` : visual.file;
}

/**
 * The open screenshot, full size over the page — the app's one modal idiom (the
 * estimate modal's): a fixed overlay that closes on a click, a stopPropagation'd
 * body, Escape to dismiss. The arrows are the carousel's own: ← and → step and
 * stop at the ends — a step sequence has a first and a last, and the disabled
 * arrow is what says "you are at the edge". With a single screenshot there is
 * nothing to step through and no arrow renders.
 */
function ScreenshotLightbox({
  repoId,
  where,
  screenshots,
  index,
  onIndex,
  onClose,
}: {
  repoId: string;
  where: api.GuardEvidenceWhere;
  screenshots: readonly GuardEvidenceVisual[];
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
}) {
  const count = screenshots.length;
  const step = useCallback(
    (delta: number) => onIndex(Math.max(0, Math.min(count - 1, index + delta))),
    [count, index, onIndex],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      if (count < 2) return;
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count, onClose, step]);

  const visual = screenshots[index];
  if (!visual) return null;
  const label = visualLabel(visual);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Evidence screenshot"
    >
      {/* Arrows OUTSIDE the header+image column, so the title's left edge and
          the close button's right edge line up with the image's own edges. */}
      <div
        className="flex max-h-full w-full max-w-4xl items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        {count > 1 && (
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={index === 0}
            aria-label="Previous screenshot"
            className="shrink-0 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-white/10"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        <div className="flex max-h-full min-h-0 min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-white">{label}</span>
            <span className="truncate font-mono text-[10px] text-white/60">{visual.file}</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close screenshot"
              className="-my-1 -mr-1 ml-auto shrink-0 rounded p-1 text-white/80 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <img
            src={api.guardEvidenceVisualUrl(repoId, where, visual.file)}
            alt={`${label} screenshot`}
            className="min-h-0 w-full flex-1 rounded border border-white/20 bg-white object-contain"
          />
        </div>
        {count > 1 && (
          <button
            type="button"
            onClick={() => step(1)}
            disabled={index === count - 1}
            aria-label="Next screenshot"
            className="shrink-0 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-white/10"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}

export function GuardEvidenceVisuals({
  repoId,
  where,
  visuals,
}: {
  repoId: string;
  /** The bundle these came from — the same handle their bytes are addressed by. */
  where: api.GuardEvidenceWhere;
  /** In reading order, as the server listed them: screenshots by step, video last. */
  visuals: readonly GuardEvidenceVisual[];
}) {
  const screenshots = visuals.filter((v) => v.kind === 'screenshot');
  const videos = visuals.filter((v) => v.kind === 'video');
  // Which screenshot the carousel is showing; null = closed. Keyed on the
  // sequence ITSELF (its file names), so a different test's evidence closes it
  // and an ordinary re-render — `visuals` may be a fresh array — does not.
  const sequence = screenshots.map((v) => v.file).join('|');
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => setOpen(null), [sequence]);

  if (visuals.length === 0) return null;

  return (
    <div className="mt-2 space-y-3">
      {screenshots.length > 0 && (
        <ul aria-label="evidence screenshots" className="flex flex-wrap gap-3">
          {screenshots.map((visual, i) => {
            const label = visualLabel(visual);
            return (
              <li key={visual.file} className="min-w-0">
                <button
                  type="button"
                  onClick={() => setOpen(i)}
                  aria-label={`${label} — open full size`}
                  className="block rounded focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <img
                    src={api.guardEvidenceVisualUrl(repoId, where, visual.file)}
                    alt={`${label} screenshot`}
                    // Clipped to the TOP of the page, not centred: a full-page
                    // screenshot's meaning is where the reader was looking.
                    className="h-24 w-40 rounded border border-border bg-muted object-cover object-top"
                  />
                </button>
                <div className="mt-0.5 text-[10px] text-muted-foreground">{label}</div>
              </li>
            );
          })}
        </ul>
      )}
      {videos.map((visual) => (
        <video
          key={visual.file}
          src={api.guardEvidenceVisualUrl(repoId, where, visual.file)}
          controls
          aria-label="session video"
          className="w-full max-w-md rounded border border-border"
        />
      ))}
      {open != null && (
        <ScreenshotLightbox
          repoId={repoId}
          where={where}
          screenshots={screenshots}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
