/**
 * The VISUAL half of an evidence bundle, inside the investigation rail: the
 * selected step's screenshot at reading size, the per-step sequence beneath it,
 * and the session video after them.
 *
 * A web step spawns nothing — no exit code, no streams — so a picture is the only
 * record of what it did. It renders for a GREEN run exactly as for a red one:
 * visuals are evidence, not failure decoration.
 *
 * Additive by construction. A bundle with no visuals (every cli/api run, and every
 * run recorded before the web driver existed) renders NOTHING — the evidence section
 * is then the transcript alone, unchanged.
 *
 * A thumbnail selects its timeline step; the featured screenshot opens the run's
 * screenshots as ONE CAROUSEL, full size, in the app:
 * a browser run is a sequence, and reading it means stepping through it — back and
 * next, ← and →, Escape or a click outside to leave. The video is not in it: a
 * player is already its own full reading, and a control surface that scrubs does
 * not belong under arrow keys that step.
 */

import { useCallback, useEffect, useState } from "react";
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
            <span className="truncate font-mono text-[10px] text-white/60">
              {visual.file}
            </span>
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
  selectedStep,
  failedStep,
  onSelectStep,
}: {
  repoId: string;
  /** The bundle these came from — the same handle their bytes are addressed by. */
  where: api.GuardEvidenceWhere;
  /** In reading order, as the server listed them: screenshots by step, video last. */
  visuals: readonly GuardEvidenceVisual[];
  /** The timeline step currently being inspected. */
  selectedStep?: number;
  /** The one screenshot that records the failure, when the run has it. */
  failedStep?: number;
  /** Keep the timeline and visual sequence on the same step. */
  onSelectStep?: (step: number) => void;
}) {
  const screenshots = visuals.filter((v) => v.kind === "screenshot");
  const videos = visuals.filter((v) => v.kind === "video");
  // Which screenshot the carousel is showing; null = closed. Keyed on the
  // sequence ITSELF (its file names), so a different test's evidence closes it
  // and an ordinary re-render — `visuals` may be a fresh array — does not.
  const sequence = screenshots.map((v) => v.file).join("|");
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => setOpen(null), [sequence]);
  const selectedIndex =
    selectedStep == null
      ? 0
      : screenshots.findIndex((visual) => visual.step === selectedStep);
  const selected = selectedIndex >= 0 ? screenshots[selectedIndex] : undefined;
  const selectScreenshot = (index: number) => {
    const visual = screenshots[index];
    if (visual?.step != null) onSelectStep?.(visual.step);
  };

  if (visuals.length === 0) return null;

  return (
    <div className="mt-2 space-y-3">
      {screenshots.length > 0 && (
        <div>
          {selected ? (
            <div>
              <div className="mb-1.5 flex min-w-0 items-center gap-2">
                <span className="text-[11px] font-medium text-foreground">
                  {visualLabel(selected)}
                </span>
                {selected.step === failedStep && (
                  <span className="text-[10px] font-medium text-red-600 dark:text-red-400">
                    failure
                  </span>
                )}
                <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
                  {selectedIndex + 1} of {screenshots.length}
                </span>
                {screenshots.length > 1 && (
                  <div className="flex shrink-0 items-center rounded border border-border">
                    <button
                      type="button"
                      onClick={() => selectScreenshot(selectedIndex - 1)}
                      disabled={selectedIndex === 0}
                      aria-label="Previous evidence screenshot"
                      className="rounded-l p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-30"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => selectScreenshot(selectedIndex + 1)}
                      disabled={selectedIndex === screenshots.length - 1}
                      aria-label="Next evidence screenshot"
                      className="rounded-r border-l border-border p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-30"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpen(selectedIndex)}
                aria-label={`${visualLabel(selected)} — open full size`}
                className="group block w-full rounded outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <img
                  src={api.guardEvidenceVisualUrl(repoId, where, selected.file)}
                  alt={`${visualLabel(selected)} screenshot`}
                  className="aspect-video max-h-[28rem] w-full rounded border border-border bg-muted object-contain object-top"
                />
                <span className="mt-1 block text-right text-[10px] text-muted-foreground group-hover:text-foreground">
                  Open full size
                </span>
              </button>
            </div>
          ) : selectedStep != null ? (
            <p className="rounded border border-dashed border-border px-3 py-3 text-[11px] leading-relaxed text-muted-foreground">
              No screenshot was recorded for step {selectedStep}. Choose a
              captured step below to inspect its page.
            </p>
          ) : null}

          <ul
            aria-label="evidence screenshots"
            className="scrollbar-thin mt-2 flex snap-x gap-2 overflow-x-auto pb-2"
          >
            {screenshots.map((visual) => {
              const label = visualLabel(visual);
              const active = visual.file === selected?.file;
              return (
                <li key={visual.file} className="w-32 shrink-0 snap-start">
                  <button
                    type="button"
                    onClick={() => {
                      if (visual.step != null) onSelectStep?.(visual.step);
                    }}
                    aria-label={`Select ${label} screenshot`}
                    aria-pressed={active}
                    className={`block w-full rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      active ? "ring-1 ring-primary" : ""
                    }`}
                  >
                    <img
                      src={api.guardEvidenceVisualUrl(
                        repoId,
                        where,
                        visual.file,
                      )}
                      alt={`${label} screenshot`}
                      className="aspect-video w-full rounded border border-border bg-muted object-cover object-top"
                    />
                    <span className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span>{label}</span>
                      {visual.step === failedStep && (
                        <span className="ml-auto font-medium text-red-600 dark:text-red-400">
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
      )}
      {videos.length > 0 && (
        <details className="group overflow-hidden rounded border border-border bg-card/40">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[11px] font-medium text-foreground outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
            <CirclePlay className="h-3.5 w-3.5 text-muted-foreground" />
            Session replay
            <span className="ml-auto text-[10px] text-muted-foreground">
              {videos.length} recording{videos.length === 1 ? "" : "s"}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-2 border-t border-border p-2">
            {videos.map((visual) => (
              <video
                key={visual.file}
                src={api.guardEvidenceVisualUrl(repoId, where, visual.file)}
                controls
                aria-label="session video"
                preload="metadata"
                className="aspect-video w-full rounded border border-border bg-black"
              />
            ))}
          </div>
        </details>
      )}
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
