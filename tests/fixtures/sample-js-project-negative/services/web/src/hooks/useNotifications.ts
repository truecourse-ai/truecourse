/**
 * Custom hook for notification management.
 */

import { useState, useEffect, useCallback } from 'react';

interface Notification {
  id: string;
  title: string;
  read: boolean;
}

// React custom hooks (useX) are skipped by missing-return-type
// and missing-boundary-types — return type is inferred from
// the body's hook calls and changes when underlying lib types
// change.
export function useNotifications(userId: string) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);

  // missing-return-type skips nested local functions.
  async function fetchNotifications() {
    setLoading(true);
    try {
      // VIOLATION: reliability/deterministic/http-call-no-timeout
      const res = await fetch(`https://api.example.com/notifications/${userId}`);
      const data = await res.json();
      setNotifications(data);
    } catch (err) {
      // console-error-no-context now skips inside `catch` blocks — the surrounding try makes the operation context self-evident.
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // NOTE: floating-promise — skipped inside useEffect callback (standard React pattern)
    fetchNotifications();
  }, [userId]);

  // VIOLATION: code-quality/deterministic/require-await
  const markAsRead = useCallback(async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
  }, []);

  return { notifications, loading, markAsRead, refresh: fetchNotifications };
}
