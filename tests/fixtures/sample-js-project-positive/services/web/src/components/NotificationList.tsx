export function NotificationList(): JSX.Element {
  return <div><h2>Notifications</h2></div>;
}



declare const createContext: <T>(defaultValue: T) => { Provider: (props: { value: T; children: JSX.Element }) => JSX.Element };
declare function useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void];
declare function useMemo<T>(factory: () => T, deps: ReadonlyArray<unknown>): T;
declare function useCallback<T extends (...args: any[]) => any>(fn: T, deps: ReadonlyArray<unknown>): T;
declare const subscribeToNotifications: (token: string) => Promise<void>;
declare const markNotificationRead: (id: number) => Promise<{ id: number; readAt: Date }>;
declare const formatTimestamp: (value: Date) => string;
declare const sortBy: <T>(items: T[], ...keys: Array<keyof T>) => T[];

type NotificationKind = 'mention' | 'comment' | 'reminder' | 'system';

type Notification = {
  readonly id: number;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string;
  readonly createdAt: Date;
  readonly readAt: Date | null;
  readonly priority: number;
  readonly actorId: number | null;
};

type NotificationCenterValue = {
  readonly notifications: ReadonlyArray<Notification>;
  readonly unreadCount: number;
  readonly highPriorityCount: number;
  readonly filter: NotificationKind | 'all';
  readonly setFilter: (kind: NotificationKind | 'all') => void;
  readonly selectedId: number | null;
  readonly setSelectedId: (id: number | null) => void;
  readonly dismiss: (id: number) => Promise<void>;
  readonly markAsRead: (id: number) => Promise<void>;
  readonly visibleNotifications: ReadonlyArray<Notification>;
};

type NotificationCenterProviderProps = {
  readonly token: string;
  readonly initialNotifications: ReadonlyArray<Notification>;
  readonly children: JSX.Element;
};

const NotificationCenterContext = createContext<NotificationCenterValue | null>(null);

export const NotificationCenterProvider = ({
  token,
  initialNotifications,
  children,
}: NotificationCenterProviderProps) => {
  const [notifications, setNotifications] = useState<ReadonlyArray<Notification>>(initialNotifications);
  const [filter, setFilter] = useState<NotificationKind | 'all'>('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pendingSync, setPendingSync] = useState(false);

  const visibleNotifications = useMemo(() => {
    const matching = notifications.filter((notification) => {
      if (filter === 'all') {
        return true;
      }
      return notification.kind === filter;
    });

    return sortBy(matching.slice(), 'priority', 'createdAt');
  }, [notifications, filter]);

  const unreadCount = useMemo(() => {
    return notifications.reduce((total, notification) => {
      return notification.readAt === null ? total + 1 : total;
    }, 0);
  }, [notifications]);

  const highPriorityCount = useMemo(() => {
    return notifications.filter((notification) => notification.priority >= 8 && notification.readAt === null).length;
  }, [notifications]);

  const markAsRead = useCallback(
    async (id: number) => {
      setPendingSync(true);
      const result = await markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((notification) =>
          notification.id === result.id ? { ...notification, readAt: result.readAt } : notification,
        ),
      );
      setPendingSync(false);
    },
    [token],
  );

  const dismiss = useCallback(
    async (id: number) => {
      await subscribeToNotifications(token);
      setNotifications((prev) => prev.filter((notification) => notification.id !== id));
      if (selectedId === id) {
        setSelectedId(null);
      }
    },
    [token, selectedId],
  );

  const contextValue = useMemo<NotificationCenterValue>(() => {
    return {
      notifications,
      unreadCount,
      highPriorityCount,
      filter,
      setFilter,
      selectedId,
      setSelectedId,
      dismiss,
      markAsRead,
      visibleNotifications,
    };
  }, [
    notifications,
    unreadCount,
    highPriorityCount,
    filter,
    selectedId,
    dismiss,
    markAsRead,
    visibleNotifications,
  ]);

  return (
    <NotificationCenterContext.Provider value={contextValue}>
      <div className="notification-shell">
        <header className="notification-shell__header">
          <h2>Notification Center</h2>
          <span className="notification-shell__count" aria-live="polite">
            {unreadCount} unread
          </span>
          {pendingSync ? <span className="notification-shell__sync">syncing...</span> : null}
        </header>
        <nav className="notification-shell__filters">
          <button type="button" onClick={() => setFilter('all')} aria-pressed={filter === 'all'}>
            All
          </button>
          <button type="button" onClick={() => setFilter('mention')} aria-pressed={filter === 'mention'}>
            Mentions
          </button>
          <button type="button" onClick={() => setFilter('comment')} aria-pressed={filter === 'comment'}>
            Comments
          </button>
          <button type="button" onClick={() => setFilter('reminder')} aria-pressed={filter === 'reminder'}>
            Reminders
          </button>
          <button type="button" onClick={() => setFilter('system')} aria-pressed={filter === 'system'}>
            System
          </button>
        </nav>
        <ul className="notification-shell__list">
          {visibleNotifications.map((notification) => (
            <li
              key={notification.id}
              className="notification-shell__item"
              data-read={notification.readAt !== null}
              data-selected={selectedId === notification.id}
            >
              <button type="button" onClick={() => setSelectedId(notification.id)}>
                <strong>{notification.title}</strong>
                <p>{notification.body}</p>
                <small>{formatTimestamp(notification.createdAt)}</small>
              </button>
              <div className="notification-shell__actions">
                <button type="button" onClick={() => markAsRead(notification.id)}>
                  Mark read
                </button>
                <button type="button" onClick={() => dismiss(notification.id)}>
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
        {children}
      </div>
    </NotificationCenterContext.Provider>
  );
};

NotificationCenterProvider.displayName = 'NotificationCenterProvider';
