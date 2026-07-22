import { useState } from 'react';

/**
 * Click-to-play video. At rest it shows only a play button on a clean panel —
 * no poster frame, chrome, or captions. On click it mounts a self-hosted
 * <video> with native controls (no third-party branding).
 */
export function VideoEmbed({ src, title }: { src: string; title: string }) {
  const [playing, setPlaying] = useState(false);

  return (
    <div className="post-video">
      {playing ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- captions are burned into the source
        <video src={src} title={title} controls autoPlay playsInline preload="metadata" />
      ) : (
        <button
          type="button"
          className="pv-poster"
          onClick={() => setPlaying(true)}
          aria-label={`Play video: ${title}`}
        >
          <span className="pv-play" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </button>
      )}
    </div>
  );
}
