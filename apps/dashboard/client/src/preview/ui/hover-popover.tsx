/**
 * Lightweight hover tooltip with the popover look, bordered `bg-popover`
 * surface, `shadow-md`, soft fade. Use for inline hover help anywhere we'd
 * otherwise reach for the HTML `title` attribute or the Base-UI Tooltip
 * primitive.
 *
 * Behaviour:
 *   - Default: no JS. Pure Tailwind `group` + `group-hover` toggle, absolutely
 *     positioned against the trigger: right for anything that isn't inside a
 *     clipping box.
 *   - `portal`: for a trigger that LIVES in a scroll container (a side panel, a
 *     row list), where an absolute popover is cut off at the container's edge.
 *     The surface renders into `document.body`, fixed-positioned against the
 *     trigger's rect, so it can never clip. It stays mounted either way, hover
 *     copy is part of what the vocabulary sweep reads.
 *   - `content === null | undefined` disables the popover entirely. Safe to drop
 *     into a render tree and toggle by passing/withholding the content prop.
 *   - The wrapper is `inline-flex`, so it doesn't disrupt the layout of buttons /
 *     inline icons it wraps.
 *
 * The trigger is the wrapped child. Hover anywhere on the child to surface the
 * popover.
 */

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface HoverPopoverProps {
  /** Trigger: hovering this child shows the popover. */
  children: ReactNode;
  /**
   * Popover content. Pass `null` / `undefined` to disable hover
   * behaviour while keeping the markup stable.
   */
  content: ReactNode;
  /** Where the popover anchors relative to the trigger. Default `bottom`. */
  side?: 'top' | 'bottom';
  /** Horizontal alignment of the popover edge. Default `center`. */
  align?: 'start' | 'center' | 'end';
  /**
   * Sizing presets: `auto` keeps the popover on one line, `narrow`
   * (~16rem) and `wide` (~20rem) wrap.
   */
  width?: 'auto' | 'narrow' | 'wide';
  /** Escape the nearest scroll/overflow container by rendering into the body. */
  portal?: boolean;
  /** Optional extra classes on the popover surface. */
  popoverClassName?: string;
}

const SURFACE =
  'pointer-events-none z-50 rounded border border-border bg-popover px-3 py-2 text-xs leading-snug text-popover-foreground shadow-md transition-opacity';

/** Gap between the trigger and the popover, in px, the `mt-1.5` of the CSS form. */
const OFFSET = 6;

export function HoverPopover({
  children,
  content,
  side = 'bottom',
  align = 'center',
  width = 'auto',
  portal = false,
  popoverClassName = '',
}: HoverPopoverProps) {
  const trigger = useRef<HTMLSpanElement>(null);
  const [spot, setSpot] = useState<{ top: number; left: number } | null>(null);
  const [shown, setShown] = useState(false);

  // A portaled surface can't be reached by `group-hover` (it isn't a descendant),
  // so the trigger measures itself and toggles the surface on hover/focus.
  const show = useCallback(() => {
    const el = trigger.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setSpot({
        top: side === 'top' ? r.top - OFFSET : r.bottom + OFFSET,
        left: align === 'start' ? r.left : align === 'end' ? r.right : r.left + r.width / 2,
      });
    }
    setShown(true);
  }, [side, align]);
  const hide = useCallback(() => setShown(false), []);

  if (content == null) {
    // No popover: render the trigger as-is, no group wrapper.
    return <>{children}</>;
  }

  const widthCls =
    width === 'auto'
      ? 'whitespace-nowrap'
      : width === 'narrow'
        ? 'w-64 whitespace-normal'
        : 'w-80 whitespace-normal';

  if (portal) {
    const shiftX = align === 'start' ? '0' : align === 'end' ? '-100%' : '-50%';
    const shiftY = side === 'top' ? '-100%' : '0';
    return (
      <span
        ref={trigger}
        className="relative inline-flex"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
        {createPortal(
          <span
            role="tooltip"
            style={{
              top: spot?.top ?? 0,
              left: spot?.left ?? 0,
              transform: `translate(${shiftX}, ${shiftY})`,
            }}
            className={`${SURFACE} fixed ${shown ? 'opacity-100' : 'opacity-0'} ${widthCls} ${popoverClassName}`}
            data-hover-popover=""
          >
            {content}
          </span>,
          document.body,
        )}
      </span>
    );
  }

  const sideCls = side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5';
  const alignCls =
    align === 'start'
      ? 'left-0'
      : align === 'end'
        ? 'right-0'
        : 'left-1/2 -translate-x-1/2';

  return (
    // Named group: unnamed `group-hover` fires from ANY ancestor `.group`.
    <span className="group/popover relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`${SURFACE} absolute ${sideCls} ${alignCls} ${widthCls} opacity-0 group-hover/popover:opacity-100 ${popoverClassName}`}
      >
        {content}
      </span>
    </span>
  );
}
