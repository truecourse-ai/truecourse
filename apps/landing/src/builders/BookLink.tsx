import type { ReactNode } from 'react';
import { trackEvent } from '@/lib/posthog';

export const BOOKING_URL = 'https://cal.com/mushegh-gevorgyan-asax6e/your-app-checkup';

/** Where on the /builders page the click happened, so placements can be compared. */
export type BookPlacement = 'header' | 'hero' | 'after-evening' | 'after-jobs' | 'pricing' | 'cta';

/**
 * Opens the app checkup booking page in a new tab, and records the click as
 * `book_checkup_clicked` with its placement.
 */
export function BookLink({
  placement,
  className,
  children,
}: {
  placement: BookPlacement;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      className={className}
      href={BOOKING_URL}
      target="_blank"
      rel="noreferrer"
      onClick={() => trackEvent('book_checkup_clicked', { placement, page: 'builders' })}
    >
      {children}
    </a>
  );
}
