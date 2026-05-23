/**
 * Remix / React Router file-based route module.
 *
 * The framework consumes the default export (the page component) and the
 * named `loader` / `action` by filesystem convention — no source file
 * imports them. The unused-export rule should NOT fire here.
 */

import type * as React from 'react';

interface BillingData {
  planName: string;
}

export function loader(): BillingData {
  return { planName: 'pro' };
}

export default function BillingSettingsPage(): React.ReactElement {
  return <main>Billing settings</main>;
}
