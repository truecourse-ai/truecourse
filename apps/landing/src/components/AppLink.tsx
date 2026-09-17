import type { ReactNode } from 'react';
import { APP_URL } from '@/lib/app-url';
import { trackEvent } from '@/lib/posthog';

/** Where on the site the click happened, so the CTA can be compared per surface. */
export type CtaPlacement = 'hero' | 'header' | 'cta' | 'blog';

/**
 * Link into the hosted app. Same tab (it is our own product), and every click
 * is recorded as `get_started_clicked` with its placement.
 */
export function AppLink({
  placement,
  className,
  children,
}: {
  placement: CtaPlacement;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      className={className}
      href={APP_URL}
      onClick={() => trackEvent('get_started_clicked', { placement })}
    >
      {children}
    </a>
  );
}
