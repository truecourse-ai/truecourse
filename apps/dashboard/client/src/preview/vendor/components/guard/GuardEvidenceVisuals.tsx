// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's apps/dashboard/client/src/components/guard/GuardEvidenceVisuals.tsx; delete with the preview.
/**
 * The VISUAL half of an evidence bundle, split by what each piece is evidence OF:
 *
 *   {@link GuardRunFilmstrip}     the RUN as a strip of tiles, one per captured
 *                                 step, in step order. Clicking a tile opens the
 *                                 carousel at that picture; "Go to step" inside
 *                                 the carousel lands on the step's own record.
 *                                 The failing tile is marked, because a reader
 *                                 scanning pictures is looking for exactly one of
 *                                 them. The session video LEADS the strip as the
 *                                 Replay tile, its own first frame under a play
 *                                 glyph, in the strip's tile anatomy, set off by a
 *                                 hairline; clicking it plays the recording in a
 *                                 modal ({@link GuardVideoLightbox}).
 *   {@link GuardStepScreenshot}   ONE step's screenshot, inside that step's
 *                                 expanded record, the picture is the step's own
 *                                 evidence, exactly like its url and its page
 *                                 text. A cli/api step recorded no picture, so its
 *                                 record simply has none.
 *   {@link GuardScreenshotLightbox} the run's screenshots as ONE CAROUSEL, full
 *                                 size, in the app, opened from a tile or from a
 *                                 step's picture, with "Go to step" as the way
 *                                 back to the record behind a picture.
 *                                 A browser run is a sequence, and reading it means
 *                                 stepping through it: back and next, ← and →,
 *                                 Escape or a click outside to leave. The video is
 *                                 not in it: a player is already its own full
 *                                 reading, and a control surface that scrubs does
 *                                 not belong under arrow keys that step.
 *
 * THE LIGHTBOXES GIVE THEIR SUBJECT REAL HEIGHT. `object-contain` only ever fits
 * media to the box it is IN, so a box sized by its content leaves a small
 * screenshot rendered small, the exact complaint the full-size reading exists to
 * answer. The overlays therefore hand the media column a viewport-sized box
 * (90vw × 85vh) and let `object-contain` scale UP into it.
 *
 * A web step spawns nothing, no exit code, no streams, so a picture is the only
 * record of what it did. It renders for a GREEN run exactly as for a red one:
 * visuals are evidence, not failure decoration.
 *
 * Additive by construction. A bundle with no visuals (every cli/api run, and every
 * run recorded before the web driver existed) renders NOTHING, no strip, no empty
 * gallery, no "no screenshots" line.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  CirclePlay,
  X,
} from "lucide-react";
import type { GuardEvidenceVisual } from "@/preview/vendor/shared";
import * as api from "@/preview/vendor/lib/api";

/** What one visual is called on the page, its step, or the file when it names none. */
function visualLabel(visual: GuardEvidenceVisual): string {
  return visual.step != null ? `Step ${visual.step}` : visual.file;
}

/**
 * The shared overlay shell of both lightboxes, the app's one modal idiom (the
 * estimate modal's): a fixed overlay that closes on a click, a stopPropagation'd
 * body, Escape to dismiss, a labelled header with the close button flush to the
 * media's right edge.
 */
function MediaLightbox({
  dialogLabel,
  closeLabel,
  label,
  file,
  onClose,
  action,
  before,
  after,
  children,
}: {
  /** The dialog's stable accessible name, never the per-item label. */
  dialogLabel: string;
  /** The close button's stable accessible name. */
  closeLabel: string;
  label: string;
  file: string;
  onClose: () => void;
  /** An extra header action, between the file name and the close button. */
  action?: React.ReactNode;
  before?: React.ReactNode;
  after?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={dialogLabel}
    >
      {/* The box is sized from the VIEWPORT, never from the media: a column that
          only ever grows to its content renders a 600px screenshot at 600px.
          Arrows sit OUTSIDE the header+media column, so the title's left edge
          and the close button's right edge line up with the media's own. */}
      <div
        className="flex h-[85vh] w-[90vw] items-stretch gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        {before}
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-2">
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs font-medium text-white">{label}</span>
            <span className="truncate font-mono text-[10px] text-white/60">
              {file}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {action}
              <button
                type="button"
                onClick={onClose}
                aria-label={closeLabel}
                className="-my-1 -mr-1 cursor-pointer rounded p-1 text-white/80 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </span>
          </div>
          {children}
        </div>
        {after}
      </div>
    </div>
  );
}

/**
 * The open screenshot, full size over the page. The arrows are the carousel's
 * own: ← and → step and stop at the ends, a step sequence has a first and a
 * last, and the disabled arrow is what says "you are at the edge". With a single
 * screenshot there is nothing to step through and no arrow renders.
 */
export function GuardScreenshotLightbox({
  repoId,
  where,
  screenshots,
  index,
  onIndex,
  onClose,
  onGoToStep,
}: {
  repoId: string;
  where: api.GuardEvidenceWhere;
  screenshots: readonly GuardEvidenceVisual[];
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
  /** Leave the carousel at this picture's step, expand it and bring it into view. */
  onGoToStep?: (step: number) => void;
}) {
  const count = screenshots.length;
  const step = useCallback(
    (delta: number) => onIndex(Math.max(0, Math.min(count - 1, index + delta))),
    [count, index, onIndex],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (count < 2) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, onClose, step]);

  const visual = screenshots[index];
  if (!visual) return null;
  const label = visualLabel(visual);

  const arrow = (delta: -1 | 1) =>
    count > 1 ? (
      <button
        type="button"
        onClick={() => step(delta)}
        disabled={delta === -1 ? index === 0 : index === count - 1}
        aria-label={delta === -1 ? "Previous screenshot" : "Next screenshot"}
        className="my-auto shrink-0 cursor-pointer rounded-full bg-white/10 p-2 text-white hover:bg-white/20 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-white/10"
      >
        {delta === -1 ? (
          <ChevronLeft className="h-5 w-5" />
        ) : (
          <ChevronRight className="h-5 w-5" />
        )}
      </button>
    ) : undefined;

  return (
    <MediaLightbox
      dialogLabel="Evidence screenshot"
      closeLabel="Close screenshot"
      label={label}
      file={visual.file}
      onClose={onClose}
      {...(onGoToStep && visual.step != null
        ? {
            action: (
              <button
                type="button"
                onClick={() => onGoToStep(visual.step!)}
                className="cursor-pointer rounded px-1.5 py-0.5 text-[11px] text-white/80 outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white"
              >
                Go to step {visual.step}
              </button>
            ),
          }
        : {})}
      before={arrow(-1)}
      after={arrow(1)}
    >
      <img
        src={api.guardEvidenceVisualUrl(repoId, where, visual.file)}
        alt={`${label} screenshot`}
        className="h-full min-h-0 w-full flex-1 rounded border border-white/20 bg-white object-contain"
      />
    </MediaLightbox>
  );
}

/** The session recording, playing over the page, opened from the Replay tile. */
export function GuardVideoLightbox({
  repoId,
  where,
  video,
  onClose,
}: {
  repoId: string;
  where: api.GuardEvidenceWhere;
  video: GuardEvidenceVisual;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <MediaLightbox
      dialogLabel="Evidence Replay"
      closeLabel="Close Replay"
      label="Replay"
      file={video.file}
      onClose={onClose}
    >
      <video
        src={api.guardEvidenceVisualUrl(repoId, where, video.file)}
        controls
        autoPlay
        aria-label="session video"
        className="h-full min-h-0 w-full flex-1 rounded border border-white/20 bg-black object-contain"
      />
    </MediaLightbox>
  );
}

/**
 * One step's screenshot, inside that step's expanded record. Clicking it opens
 * the run's carousel at this step ({@link GuardScreenshotLightbox}, owned by the
 * page so every picture shares one open state).
 */
export function GuardStepScreenshot({
  repoId,
  where,
  visual,
  onOpen,
}: {
  repoId: string;
  where: api.GuardEvidenceWhere;
  visual: GuardEvidenceVisual;
  onOpen: () => void;
}) {
  const label = visualLabel(visual);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${label}, open full size`}
      className="group block w-full cursor-pointer rounded outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <img
        src={api.guardEvidenceVisualUrl(repoId, where, visual.file)}
        alt={`${label} screenshot`}
        className="w-full rounded border border-border bg-muted object-contain object-top"
      />
      <span className="mt-1 block text-right text-[10px] text-muted-foreground group-hover:text-foreground">
        Open full size
      </span>
    </button>
  );
}

/**
 * THE RUN AS A STRIP, one tile per captured step, in step order, doubling as a
 * photographic index. It is not a time axis: guard runs 2–24 steps, so a tile
 * maps to a step, and clicking one expands that step in the list below and
 * brings its picture into view.
 */
export function GuardRunFilmstrip({
  repoId,
  where,
  screenshots,
  videos,
  failedStep,
  onOpenShot,
  onGoToStep,
}: {
  repoId: string;
  /** The bundle these came from, the same handle their bytes are addressed by. */
  where: api.GuardEvidenceWhere;
  /** In step order, as the server listed them. */
  screenshots: readonly GuardEvidenceVisual[];
  /** The session recording, when the run kept one. */
  videos: readonly GuardEvidenceVisual[];
  /** The one screenshot that records the failure, when the run has it. */
  failedStep?: number;
  /** Open the carousel at this index of the screenshot sequence. */
  onOpenShot: (index: number) => void;
  /** Expand this step's record and bring it into view, the tile-level jump. */
  onGoToStep?: (step: number) => void;
}) {
  const [replay, setReplay] = useState(false);

  if (screenshots.length === 0) return null;

  return (
    <section aria-label="Run filmstrip" className="min-w-0 shrink-0">
      {/* The strip is a FRAMED BAND, like the verdict card, the run's
          photographic record is a first-class pane of the workspace, not loose
          thumbnails floating between two framed neighbours. */}
      <div className="flex min-w-0 items-start gap-2 rounded border border-border bg-card p-2">
        {videos.length > 0 && (
          <>
            {/* The session video, AS A TILE, the strip's own vocabulary, not a
                chip beside it. It LEADS the strip: the whole-run record first,
                then the per-step frames, with a hairline keeping the two kinds
                of evidence apart. The poster is the recording's first frame
                (its own honest thumbnail) under a scrim, with the play glyph
                every video player has taught readers to press. Clicking plays
                the recording in a modal. */}
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => setReplay(true)}
              className="group block w-32 shrink-0 cursor-pointer rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="relative block aspect-video w-full overflow-hidden rounded border border-border bg-black">
                <video
                  aria-hidden
                  tabIndex={-1}
                  muted
                  preload="metadata"
                  src={api.guardEvidenceVisualUrl(
                    repoId,
                    where,
                    videos[0]!.file,
                  )}
                  className="pointer-events-none h-full w-full object-cover object-top"
                />
                {/* The scrim earns the glyph its contrast, a run's first frame
                    is usually a white page, and a white glyph on it would
                    vanish. */}
                <span className="absolute inset-0 flex items-center justify-center bg-black/40 transition-colors group-hover:bg-black/50">
                  <CirclePlay
                    aria-hidden
                    className="h-8 w-8 text-white drop-shadow-sm transition-transform group-hover:scale-110 motion-reduce:transition-none"
                  />
                </span>
              </span>
              <span className="mt-0.5 block truncate text-[10px] font-medium text-muted-foreground group-hover:text-foreground">
                Replay
              </span>
            </button>
            {/* The hairline between the two kinds of evidence: one session, many
                steps. `self-stretch` spans the tile and its label line alike. */}
            <span aria-hidden className="w-px shrink-0 self-stretch bg-border" />
          </>
        )}
        <ul
          aria-label="evidence screenshots"
          className="scrollbar-thin flex min-w-0 flex-1 snap-x gap-1.5 overflow-x-auto pb-1"
        >
          {screenshots.map((visual, index) => {
            const label = visualLabel(visual);
            const failed = visual.step === failedStep;
            return (
              <li key={visual.file} className="w-32 shrink-0 snap-start">
                {/* The image is the way into the carousel; the label row below
                    carries the step-level jump, so the two actions never nest. */}
                <button
                  type="button"
                  onClick={() => onOpenShot(index)}
                  aria-label={`Open ${label}`}
                  className="block w-full cursor-pointer rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <img
                    src={api.guardEvidenceVisualUrl(repoId, where, visual.file)}
                    alt={`${label} screenshot`}
                    className={`aspect-video w-full rounded border bg-muted object-cover object-top ${
                      failed ? "border-red-500/70" : "border-border"
                    }`}
                  />
                </button>
                <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="truncate">{label}</span>
                  <span className="ml-auto inline-flex shrink-0 items-center gap-0.5">
                    {failed && (
                      <span className="inline-flex items-center gap-0.5 font-medium text-red-600 dark:text-red-400">
                        <X aria-hidden className="h-3 w-3 shrink-0" />
                        failed
                      </span>
                    )}
                    {visual.step != null && onGoToStep && (
                      <button
                        type="button"
                        onClick={() => onGoToStep(visual.step!)}
                        aria-label={`Go to step ${visual.step}`}
                        title={`Go to step ${visual.step}`}
                        className="cursor-pointer rounded p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <ArrowDown aria-hidden className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      {replay && videos[0] && (
        <GuardVideoLightbox
          repoId={repoId}
          where={where}
          video={videos[0]}
          onClose={() => setReplay(false)}
        />
      )}
    </section>
  );
}
