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
 * A thumbnail is a link to the file itself, opened full size in a new tab: the
 * app has no lightbox, and inventing one here would be a second idiom for a thing
 * the browser already does well.
 */

import type { GuardEvidenceVisual } from '@truecourse/shared';
import * as api from '@/lib/api';

/** What one visual is called on the page — its step, or the file when it names none. */
function visualLabel(visual: GuardEvidenceVisual): string {
  return visual.step != null ? `Step ${visual.step}` : visual.file;
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
  if (visuals.length === 0) return null;
  const screenshots = visuals.filter((v) => v.kind === 'screenshot');
  const videos = visuals.filter((v) => v.kind === 'video');

  return (
    <div className="mt-2 space-y-3">
      {screenshots.length > 0 && (
        <ul aria-label="evidence screenshots" className="flex flex-wrap gap-3">
          {screenshots.map((visual) => {
            const label = visualLabel(visual);
            const href = api.guardEvidenceVisualUrl(repoId, where, visual.file);
            return (
              <li key={visual.file} className="min-w-0">
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  title={`${visual.file} — open full size`}
                  className="block"
                >
                  <img
                    src={href}
                    alt={`${label} screenshot`}
                    // Clipped to the TOP of the page, not centred: a full-page
                    // screenshot's meaning is where the reader was looking.
                    className="h-24 w-40 rounded border border-border bg-muted object-cover object-top"
                  />
                </a>
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
    </div>
  );
}
