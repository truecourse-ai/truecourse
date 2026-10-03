import type { ReactNode } from 'react';
import { useFit } from './motion';

/**
 * The frame a scene is drawn in: `width` by `height` stage pixels, scaled to
 * the column it sits in and keeping its shape at every width.
 */
export function Stage({
  width,
  height,
  className,
  label,
  children,
}: {
  width: number;
  height: number;
  className?: string;
  /** What the scene shows, for a reader that cannot see it. */
  label: string;
  children: ReactNode;
}) {
  const { ref, k } = useFit(width);
  return (
    <div
      ref={ref}
      className={`bs-stage ${className ?? ''}`}
      style={{ aspectRatio: `${width} / ${height}` }}
      role="img"
      aria-label={label}
    >
      <div className="bs-canvas" style={{ width, height, transform: `scale(${k})` }} aria-hidden="true">
        {children}
      </div>
    </div>
  );
}
