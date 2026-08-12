/**
 * The VISUAL half of an evidence bundle, split by what each piece is evidence OF:
 *
 *   {@link GuardRunFilmstrip}     the RUN as a strip of tiles, one per captured
 *                                 step, in step order — the workspace's second
 *                                 index onto the same selection the step list
 *                                 carries. Hovering a tile shows it at reading
 *                                 size — the picture only, never the selection;
 *                                 clicking pins that step. The failing tile is
 *                                 marked, because a reader scanning pictures is
 *                                 looking for exactly one of them. The session
 *                                 video LEADS the strip as the Replay tile —
 *                                 its own first frame under a play glyph, in the
 *                                 strip's tile anatomy, set off by a hairline,
 *                                 because it is evidence like its neighbours but
 *                                 a different kind: the whole session, not a
 *                                 step.
 *   {@link GuardStepScreenshot}   ONE step's screenshot, inside that step's
 *                                 inspector, on its `Screen` tab — the picture is
 *                                 the step's own record, exactly like its url and
 *                                 its page text. A cli/api step recorded no
 *                                 picture, so it is offered no such tab.
 *   {@link GuardScreenshotLightbox} the run's screenshots as ONE CAROUSEL, full
 *                                 size, in the app — opened from the Screen tab or
 *                                 with Enter on a step that has one. A browser run
 *                                 is a sequence, and reading it means stepping
 *                                 through it: back and next, ← and →, Escape or a
 *                                 click outside to leave. The video is not in it: a
 *                                 player is already its own full reading, and a
 *                                 control surface that scrubs does not belong under
 *                                 arrow keys that step.
 *
 * THE LIGHTBOX GIVES THE PICTURE REAL HEIGHT. `object-contain` only ever fits an
 * image to the box it is IN, so a box sized by its content leaves a small
 * screenshot rendered small — the exact complaint the full-size reading exists to
 * answer. The overlay therefore hands the image column a viewport-sized box
 * (90vw × 85vh) and lets `object-contain` scale UP into it.
 *
 * A web step spawns nothing — no exit code, no streams — so a picture is the only
 * record of what it did. It renders for a GREEN run exactly as for a red one:
 * visuals are evidence, not failure decoration.
 *
 * Additive by construction. A bundle with no visuals (every cli/api run, and every
 * run recorded before the web driver existed) renders NOTHING — no strip, no empty
 * gallery, no "no screenshots" line.
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CirclePlay,
  X,
} from "lucide-react";
import type { GuardEvidenceVisual } from "@truecourse/shared";
import * as api from "@/lib/api";

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
export function GuardScreenshotLightbox({
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Evidence screenshot"
    >
      {/* The box is sized from the VIEWPORT, never from the picture: an image
          column that only ever grows to its content renders a 600px screenshot at
          600px. Arrows sit OUTSIDE the header+image column, so the title's left
          edge and the close button's right edge line up with the image's own. */}
      <div
        className="flex h-[85vh] w-[90vw] items-stretch gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        {count > 1 && (
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={index === 0}
            aria-label="Previous screenshot"
            className="my-auto shrink-0 cursor-pointer rounded-full bg-white/10 p-2 text-white hover:bg-white/20 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-white/10"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-2">
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs font-medium text-white">{label}</span>
            <span className="truncate font-mono text-[10px] text-white/60">
              {visual.file}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close screenshot"
              className="-my-1 -mr-1 ml-auto shrink-0 cursor-pointer rounded p-1 text-white/80 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <img
            src={api.guardEvidenceVisualUrl(repoId, where, visual.file)}
            alt={`${label} screenshot`}
            className="h-full min-h-0 w-full flex-1 rounded border border-white/20 bg-white object-contain"
          />
        </div>
        {count > 1 && (
          <button
            type="button"
            onClick={() => step(1)}
            disabled={index === count - 1}
            aria-label="Next screenshot"
            className="my-auto shrink-0 cursor-pointer rounded-full bg-white/10 p-2 text-white hover:bg-white/20 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-white/10"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * One step's screenshot, on its inspector's `Screen` tab. Clicking it opens the
 * run's carousel at this step ({@link GuardScreenshotLightbox}, owned by the page
 * so the tab and the carousel share one open state) — the same thing Enter on the
 * step row does.
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
      aria-label={`${label} — open full size`}
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
 * The hovered tile at reading size, over the page — the strip's preview channel.
 * It opens BELOW the strip (the strip lives at the top of the workspace, so above
 * it there is only the app header) and clamps to the viewport on both axes: a
 * first or last tile's preview slides inward instead of bleeding off the edge.
 */
function TilePreview({
  src,
  label,
  rect,
}: {
  src: string;
  label: string;
  rect: DOMRect;
}) {
  const width = Math.min(544, window.innerWidth * 0.7);
  const half = width / 2 + 8;
  const center = Math.min(
    Math.max(rect.left + rect.width / 2, half),
    window.innerWidth - half,
  );
  const top = rect.bottom + 8;
  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 -translate-x-1/2 rounded border border-border bg-popover p-1 shadow-md shadow-black/20"
      style={{ left: center, top }}
    >
      <img
        src={src}
        alt={`${label} screenshot`}
        className="rounded bg-muted object-contain object-top"
        style={{
          width,
          maxHeight: Math.max(120, window.innerHeight - top - 16),
        }}
      />
    </div>,
    document.body,
  );
}

/**
 * THE RUN AS A STRIP — one tile per captured step, in step order, doubling as the
 * step scrubber. It is not a time axis: guard runs 2–24 steps, so a tile maps to a
 * step, and the strip and the step list are two indexes onto one selection.
 */
export function GuardRunFilmstrip({
  repoId,
  where,
  screenshots,
  videos,
  selectedStep,
  failedStep,
  onSelectStep,
}: {
  repoId: string;
  /** The bundle these came from — the same handle their bytes are addressed by. */
  where: api.GuardEvidenceWhere;
  /** In step order, as the server listed them. */
  screenshots: readonly GuardEvidenceVisual[];
  /** The session recording, when the run kept one. */
  videos: readonly GuardEvidenceVisual[];
  /** The step the workspace is pinned to. */
  selectedStep?: number;
  /** The one screenshot that records the failure, when the run has it. */
  failedStep?: number;
  /** Pin the workspace to this step. */
  onSelectStep: (step: number) => void;
}) {
  const [preview, setPreview] = useState<{
    file: string;
    label: string;
    rect: DOMRect;
  } | null>(null);
  const [replay, setReplay] = useState(false);

  if (screenshots.length === 0) return null;

  return (
    <section
      aria-label="Run filmstrip"
      className="min-w-0 shrink-0"
      onMouseLeave={() => setPreview(null)}
    >
      {/* The strip is a FRAMED BAND, like the verdict card and the inspector —
          the run's photographic record is a first-class pane of the workspace,
          not loose thumbnails floating between two framed neighbours. */}
      <div className="flex min-w-0 items-start gap-2 rounded border border-border bg-card p-2">
        {videos.length > 0 && (
          <>
            {/* The session video, AS A TILE — the strip's own vocabulary, not a
                chip beside it. It LEADS the strip: the whole-run record first,
                then the per-step frames, with a hairline keeping the two kinds
                of evidence apart. The poster is the recording's first frame
                (its own honest thumbnail) under a scrim, with the play glyph
                every video player has taught readers to press. Clicking toggles
                the player below, exactly as before; the open state wears the
                selected tile's ring. */}
            <button
              type="button"
              aria-expanded={replay}
              aria-controls="guard-session-replay"
              onClick={() => setReplay((open) => !open)}
              className={`group block w-32 shrink-0 cursor-pointer rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                replay
                  ? "ring-2 ring-primary"
                  : "hover:ring-1 hover:ring-primary/40"
              }`}
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
                {/* The scrim earns the glyph its contrast — a run's first frame
                    is usually a white page, and a white glyph on it would
                    vanish. */}
                <span className="absolute inset-0 flex items-center justify-center bg-black/40 transition-colors group-hover:bg-black/50">
                  <CirclePlay
                    aria-hidden
                    className="h-8 w-8 text-white drop-shadow-sm transition-transform group-hover:scale-110 motion-reduce:transition-none"
                  />
                </span>
              </span>
              <span className="mt-0.5 flex items-center gap-1 text-[10px] font-medium text-muted-foreground group-hover:text-foreground">
                <span className="truncate">Replay</span>
                <ChevronDown
                  aria-hidden
                  className={`ml-auto h-3 w-3 shrink-0 transition-transform ${replay ? "rotate-180" : ""}`}
                />
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
          {screenshots.map((visual) => {
            const label = visualLabel(visual);
            const selected =
              visual.step != null && visual.step === selectedStep;
            const failed = visual.step === failedStep;
            return (
              <li key={visual.file} className="w-32 shrink-0 snap-start">
                <button
                  type="button"
                  onClick={() => {
                    if (visual.step != null) onSelectStep(visual.step);
                  }}
                  onMouseEnter={(e) =>
                    setPreview({
                      file: visual.file,
                      label,
                      rect: e.currentTarget.getBoundingClientRect(),
                    })
                  }
                  // Cleared per tile, not only when the pointer leaves the whole
                  // section — the Replay button shares the section, and a preview
                  // that lingers over it reads as a stuck tooltip.
                  onMouseLeave={() => setPreview(null)}
                  aria-label={`Select ${label} screenshot`}
                  aria-pressed={selected}
                  className={`block w-full cursor-pointer rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    selected
                      ? "ring-2 ring-primary"
                      : "hover:ring-1 hover:ring-primary/40"
                  }`}
                >
                  <img
                    src={api.guardEvidenceVisualUrl(repoId, where, visual.file)}
                    alt={`${label} screenshot`}
                    className={`aspect-video w-full rounded border bg-muted object-cover object-top ${
                      failed ? "border-red-500/70" : "border-border"
                    }`}
                  />
                  <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="truncate">{label}</span>
                    {failed && (
                      <span className="ml-auto inline-flex items-center gap-0.5 font-medium text-red-600 dark:text-red-400">
                        <X aria-hidden className="h-3 w-3 shrink-0" />
                        failed
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {/* The session recording is the WHOLE run, not any one step, so it opens
          under the strip rather than inside a tile. */}
      {videos.length > 0 && (
        <div
          id="guard-session-replay"
          className={`mt-1.5 space-y-1.5 ${replay ? "" : "hidden"}`}
        >
          {videos.map((visual) => (
            <video
              key={visual.file}
              src={api.guardEvidenceVisualUrl(repoId, where, visual.file)}
              controls
              aria-label="session video"
              preload="metadata"
              className="max-h-[45vh] w-full rounded border border-border bg-black"
            />
          ))}
        </div>
      )}
      {preview && (
        <TilePreview
          src={api.guardEvidenceVisualUrl(repoId, where, preview.file)}
          label={preview.label}
          rect={preview.rect}
        />
      )}
    </section>
  );
}
