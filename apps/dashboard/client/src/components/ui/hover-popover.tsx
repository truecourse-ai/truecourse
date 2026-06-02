/**
 * Lightweight CSS-only hover tooltip with the popover look — bordered
 * `bg-popover` surface, `shadow-md`, soft fade on `group-hover`. Use
 * for inline hover help anywhere we'd otherwise reach for the HTML
 * `title` attribute or the Base-UI Tooltip primitive.
 *
 * Behaviour:
 *   - No JS / portal. Pure Tailwind `group` + `group-hover` toggle.
 *   - `content === null | undefined` disables the popover entirely.
 *     Safe to drop into a render tree and toggle by passing/withholding
 *     the content prop.
 *   - The wrapper is `inline-flex`, so it doesn't disrupt the layout
 *     of buttons / inline icons it wraps.
 *
 * The trigger is the wrapped child. Hover anywhere on the child to
 * surface the popover.
 */

import type { ReactNode } from 'react';

interface HoverPopoverProps {
  /** Trigger — hovering this child shows the popover. */
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
   * Sizing presets — `auto` keeps the popover on one line, `narrow`
   * (~16rem) and `wide` (~20rem) wrap.
   */
  width?: 'auto' | 'narrow' | 'wide';
  /** Optional extra classes on the popover surface. */
  popoverClassName?: string;
}

export function HoverPopover({
  children,
  content,
  side = 'bottom',
  align = 'center',
  width = 'auto',
  popoverClassName = '',
}: HoverPopoverProps) {
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
  const sideCls = side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5';
  const alignCls =
    align === 'start'
      ? 'left-0'
      : align === 'end'
        ? 'right-0'
        : 'left-1/2 -translate-x-1/2';

  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 ${sideCls} ${alignCls} ${widthCls} rounded border border-border bg-popover px-3 py-2 text-xs leading-snug text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 ${popoverClassName}`}
      >
        {content}
      </span>
    </span>
  );
}
