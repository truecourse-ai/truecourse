import type { ReactNode } from 'react';
import { trackEvent } from '@/lib/posthog';

export const BOOKING_URL = 'https://cal.com/mushegh-gevorgyan-asax6e/hire-you-ai-cto';

/** Where on the /builders page the click happened, so placements can be compared. */
export type BookPlacement = 'header' | 'hero' | 'after-evening' | 'after-jobs' | 'cta';

/**
 * Opens the meeting booking page in a new tab, and records the click as
 * `talk_to_us_clicked` with its placement.
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
      onClick={() => trackEvent('talk_to_us_clicked', { placement, page: 'builders' })}
    >
      {children}
    </a>
  );
}
