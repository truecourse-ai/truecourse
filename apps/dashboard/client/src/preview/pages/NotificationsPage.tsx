// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.

/**
 * Notifications: the durable feed behind the sidebar bell. A gate failure, a
 * generation blocked on unresolved conflicts, a spec-change offer waiting for
 * an answer, an onboarding that finished.
 *
 * A row's level is the status idiom (a dot and a word), not a tinted capsule,
 * and unread is a dot on the row itself. Reading one clears its dot; "Mark all
 * read" clears the badge.
 */

import { useState } from 'react';
import { EntityList } from '@/preview/ui/entity-list';
import { PageHeader } from '@/preview/ui/bits';
import { StatusWord, type StatusTone } from '@/preview/ui/status-word';
import type { PreviewNotification } from '@/preview/data/types';
import { usePreviewState } from '@/preview/shell/preview-state';

const LEVEL_TONE: Record<PreviewNotification['level'], StatusTone> = {
  success: 'success',
  failure: 'failure',
  blocked: 'blocked',
  neutral: 'neutral',
};

const LEVEL_WORD: Record<PreviewNotification['level'], string> = {
  success: 'Done',
  failure: 'Failed',
  blocked: 'Blocked',
  neutral: 'Waiting',
};

export default function NotificationsPage() {
  const { notifications, unreadCount, markRead, markAllRead } = usePreviewState();
  const [readFilter, setReadFilter] = useState<string[]>([]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Notifications"
        subtitle={unreadCount > 0 ? `${unreadCount} unread` : undefined}
        right={
          unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="rounded border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60"
            >
              Mark all read
            </button>
          )
        }
      />
      <div className="min-h-0 flex-1">
        <EntityList<PreviewNotification>
            label="Workspace notifications"
            items={notifications}
            itemId={(n) => n.id}
            renderRow={(n) => (
              <>
                <div className="flex w-full min-w-0 items-center gap-2">
                  {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="unread" />}
                  <span
                    className={`min-w-0 flex-1 truncate text-[13px] ${n.read ? 'text-foreground/90' : 'font-semibold text-foreground'}`}
                  >
                    {n.title}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{n.at}</span>
                </div>
                <StatusWord tone={LEVEL_TONE[n.level]} word={LEVEL_WORD[n.level]} />
              </>
            )}
            onOpen={(id) => markRead(id)}
            search={{
              placeholder: 'Search notifications',
              ariaLabel: 'Search notifications',
              match: (n, q) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q),
            }}
            filter={{
              label: 'Read',
              ariaLabel: 'Filter notifications by read state',
              options: [
                { key: 'unread', label: 'Unread', count: notifications.filter((n) => !n.read).length },
                { key: 'read', label: 'Read', count: notifications.filter((n) => n.read).length },
              ],
              selected: readFilter,
              onChange: setReadFilter,
              match: (n, key) => (key === 'unread' ? !n.read : n.read),
            }}
            noun={{ one: 'notification', many: 'notifications' }}
            emptyText="Nothing has happened yet."
          />
      </div>
    </div>
  );
}
