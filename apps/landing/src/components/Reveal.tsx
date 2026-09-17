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
  /** Settle in with a small rise as well as the fade (the hero). */
  rise?: boolean;
  /** How much of the element must be in view before it reveals. */
  threshold?: number;
  style?: CSSProperties;
  children?: ReactNode;
};

/**
 * Fades its element in once it scrolls into view. Pairs with the `.reveal` /
 * `.reveal.visible` rules in globals.css, which also gate the motion inside a
 * product screen. Polymorphic via `as` so it can wrap a heading, a paragraph
 * or a list item without extra markup.
 */
export function Reveal({ as = 'div', className, delay, rise, threshold, style, children }: RevealProps) {
  const { ref, visible } = useReveal<HTMLElement>({ threshold });
  return createElement(
    as,
    {
      ref,
      className: cn('reveal', rise && 'rise', visible && 'visible', className),
      style: delay != null ? { ...style, ['--delay' as string]: `${delay}ms` } : style,
    },
    children,
  );
}
