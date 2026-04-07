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
      // VIOLATION: reliability/deterministic/console-error-no-context
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // VIOLATION: reliability/deterministic/floating-promise
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
