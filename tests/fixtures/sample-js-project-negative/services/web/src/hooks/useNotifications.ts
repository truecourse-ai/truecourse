/**
 * Custom hook for notification management.
 */

import { useState, useEffect, useCallback } from 'react';

interface Notification {
  id: string;
  title: string;
  read: boolean;
}

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
export function useNotifications(userId: string) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);

  // VIOLATION: code-quality/deterministic/missing-return-type
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

  // VIOLATION: code-quality/deterministic/missing-return-type
  // VIOLATION: code-quality/deterministic/require-await
  const markAsRead = useCallback(async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
  }, []);

  return { notifications, loading, markAsRead, refresh: fetchNotifications };
}
