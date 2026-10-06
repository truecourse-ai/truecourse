import { useEffect, useState, type ReactNode } from 'react';
import { trackEvent } from '@/lib/posthog';

export const BOOKING_URL = 'https://cal.com/mushegh-gevorgyan-asax6e/your-app-checkup';

/** The ad tags Cal.com records with a booking when they are on its link. */
const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

/** The booking link, carrying the ad tags this visit arrived with, so each booking shows its ad. */
function bookingUrl(search: string): string {
  const from = new URLSearchParams(search);
  const url = new URL(BOOKING_URL);
  for (const key of UTM) {
    const value = from.get(key);
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

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
  const [href, setHref] = useState(BOOKING_URL);
  useEffect(() => setHref(bookingUrl(window.location.search)), []);
  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={() => trackEvent('book_checkup_clicked', { placement, page: 'builders' })}
    >
      {children}
    </a>
  );
}
