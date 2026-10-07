import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { getCalApi } from '@calcom/embed-react';
import { trackEvent } from '@/lib/posthog';

export const BOOKING_URL = 'https://cal.com/mushegh-gevorgyan-asax6e/your-app-checkup';
const CAL_LINK = 'mushegh-gevorgyan-asax6e/your-app-checkup';
const NAMESPACE = 'checkup';

/** The ad tags Cal.com records with a booking when they are on its link. */
const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

/** The ad tags this visit arrived with. */
function adTags(search: string): Record<string, string> {
  const from = new URLSearchParams(search);
  const tags: Record<string, string> = {};
  for (const key of UTM) {
    const value = from.get(key);
    if (value) tags[key] = value;
  }
  return tags;
}

/** The booking link carrying this visit's ad tags, so each booking shows its ad. */
function bookingUrl(search: string): string {
  const url = new URL(BOOKING_URL);
  for (const [key, value] of Object.entries(adTags(search))) url.searchParams.set(key, value);
  return url.toString();
}

/** Where on the /builders page the click happened, so placements can be compared. */
export type BookPlacement = 'header' | 'hero' | 'after-evening' | 'after-jobs' | 'pricing' | 'cta';

/** The placement whose click opened the calendar, credited when the booking lands. */
let openedFrom: BookPlacement | undefined;

/**
 * The calendar, loaded once for the page: preloaded so the popup opens at
 * once, and recording each booking made in it as `checkup_booked`.
 */
let calendar: ReturnType<typeof getCalApi> | undefined;
function loadCalendar() {
  calendar ??= getCalApi({ namespace: NAMESPACE }).then((cal) => {
    cal('ui', { theme: 'light', layout: 'month_view' });
    cal('preload', { calLink: CAL_LINK });
    cal('on', {
      action: 'bookingSuccessfulV2',
      callback: () => trackEvent('checkup_booked', { placement: openedFrom, page: 'builders' }),
    });
    return cal;
  });
  return calendar;
}

/**
 * Opens the app checkup calendar in a popup over the page, carrying this
 * visit's ad tags, and records the click as `book_checkup_clicked` with its
 * placement. A click that asks for a new tab follows the link instead.
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
  useEffect(() => {
    setHref(bookingUrl(window.location.search));
    void loadCalendar();
  }, []);

  function open(e: MouseEvent<HTMLAnchorElement>) {
    trackEvent('book_checkup_clicked', { placement, page: 'builders' });
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openedFrom = placement;
    void loadCalendar().then((cal) =>
      cal('modal', { calLink: CAL_LINK, config: { layout: 'month_view', ...adTags(window.location.search) } }),
    );
  }

  return (
    <a className={className} href={href} target="_blank" rel="noreferrer" onClick={open}>
      {children}
    </a>
  );
}
