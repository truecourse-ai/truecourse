import {
  createElement,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';
import { useReveal } from '@/lib/useReveal';

type RevealProps = {
  as?: ElementType;
  className?: string;
  /** Stagger delay in milliseconds, exposed to CSS as `--delay`. */
  delay?: number;
  style?: CSSProperties;
  children?: ReactNode;
};

/**
 * Fades + lifts its element into view on scroll. Pairs with the `.reveal` /
 * `.reveal.visible` rules in globals.css. Polymorphic via `as` so it can wrap a
 * heading, paragraph, card, or grid cell without extra markup.
 */
export function Reveal({ as = 'div', className, delay, style, children }: RevealProps) {
  const { ref, visible } = useReveal<HTMLElement>();
  return createElement(
    as,
    {
      ref,
      className: cn('reveal', visible && 'visible', className),
      style: delay != null ? { ...style, ['--delay' as string]: `${delay}ms` } : style,
    },
    children,
  );
}
