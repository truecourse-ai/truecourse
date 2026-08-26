/**
 * A page-level left panel with the shared panel-header idiom: an h-10 header
 * carrying the panel's name and the collapse chevron at its right, and the same
 * drag-to-resize right edge the main sidebar panel has. Collapsed, a thin strip
 * remains with the expand chevron at the top. Session state only, nothing saved.
 */

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function CollapsibleAside({
  label,
  defaultWidth,
  minWidth = 200,
  children,
}: {
  /** The panel's name: the header text and the toggle's accessible label. */
  label: string;
  /** Expanded width in px (user-resizable from there). */
  defaultWidth: number;
  minWidth?: number;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(defaultWidth);
  const isDragging = useRef(false);

  const toggle = () => setCollapsed((c) => !c);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      const startX = e.clientX;
      const startWidth = width;
      const maxWidth = Math.floor(window.innerWidth * 0.6);

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!isDragging.current) return;
        const delta = moveEvent.clientX - startX;
        setWidth(Math.min(maxWidth, Math.max(minWidth, startWidth + delta)));
      };
      const onMouseUp = () => {
        isDragging.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [width, minWidth],
  );

  if (collapsed) {
    return (
      <div className="flex h-full w-8 shrink-0 flex-col items-center border-r border-border bg-card pt-2">
        <button
          type="button"
          onClick={toggle}
          aria-label={`Expand ${label} panel`}
          aria-expanded={false}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }
  return (
    <aside
      className="relative flex h-full min-h-0 shrink-0 flex-col border-r border-border"
      style={{ width }}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <button
          type="button"
          onClick={toggle}
          aria-label={`Collapse ${label} panel`}
          aria-expanded
          className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      {/* Above the sticky group headers (z-20), or the hover strip dives under them. */}
      <div
        className="absolute inset-y-0 right-0 z-30 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50"
        onMouseDown={handleMouseDown}
      />
    </aside>
  );
}
