/**
 * Human "time ago" formatting, shared by the OSS dashboard client and the EE
 * client — previously copy-pasted (as `timeAgo` / `formatRelativeTime`) across
 * several components. The canonical superset of the plain relative-time
 * variants:
 *   - null / undefined / empty → "never"
 *   - an unparseable date → "—"
 *   - otherwise: just now / Ns / Nm / Nh / Nd ago
 *
 * Components that intentionally differ keep their own helper: AdminPage and
 * NotificationsPage fall back to an absolute date for old entries.
 */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}
