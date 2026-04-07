/**
 * NotificationList — displays user notifications with actions.
 */

import React, { useState, useEffect, CSSProperties } from 'react';

interface Notification {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

interface NotificationListProps {
  userId: string;
  onDismiss: (id: string) => void;
  style?: CSSProperties;
}

// VIOLATION: performance/deterministic/missing-react-memo
export function NotificationList({ userId, onDismiss, style }: NotificationListProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  // VIOLATION: performance/deterministic/event-listener-no-remove
  useEffect(() => {
    window.addEventListener('focus', () => {
      fetch(`/api/notifications/${userId}`)
        .then((res) => res.json())
        .then(setNotifications);
    });
  }, [userId]);

  useEffect(() => {
    // VIOLATION: reliability/deterministic/floating-promise
    loadNotifications();
  }, [userId]);

  // VIOLATION: code-quality/deterministic/missing-return-type
  async function loadNotifications() {
    setLoading(true);
    const res = await fetch(`/api/notifications/${userId}`);
    const data = await res.json();
    setNotifications(data);
    setLoading(false);
  }

  if (loading) {
    return <div>Loading notifications...</div>;
  }

  return (
    <div style={style}>
      <h2>Notifications ({notifications.length})</h2>
      <ul>
        {/* VIOLATION markers are above the component for these rules */}
        {notifications.map((notification, index) => (
          <li key={index}>
            <strong>{notification.title}</strong>
            <p>{notification.body}</p>
            <span>{new Date(notification.createdAt).toLocaleDateString()}</span>
            <button
              onClick={() => onDismiss(notification.id)}
            >
              Dismiss
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
