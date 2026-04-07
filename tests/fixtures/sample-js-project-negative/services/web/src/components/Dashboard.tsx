/**
 * Dashboard component — main app page.
 */

import React, { useState, useEffect } from 'react';
import { NotificationList } from './NotificationList';
import { UserSearch } from './UserSearch';

interface DashboardProps {
  userId: string;
  refreshInterval: number;
}

// VIOLATION: performance/deterministic/missing-react-memo
export function Dashboard({ userId, refreshInterval }: DashboardProps) {
  const [stats, setStats] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // VIOLATION: performance/deterministic/missing-cleanup-useeffect
  useEffect(() => {
    const interval = setInterval(() => {
      fetch(`/api/stats/${userId}`)
        .then((res) => res.json())
        .then(setStats);
    }, refreshInterval);
  }, [userId, refreshInterval]);

  // VIOLATION: bugs/deterministic/useeffect-object-dep
  useEffect(() => {
    setError(null);
  }, [{ userId }]);

  if (error) {
    return <div className="error">{error}</div>;
  }

  // VIOLATION: code-quality/deterministic/react-leaked-render
  return (
    <div className="dashboard">
      <h1>Dashboard</h1>
      {stats && stats.count && <span className="badge">{stats.count}</span>}
      <div className="panels">
        <NotificationList
          userId={userId}
          // VIOLATION: performance/deterministic/inline-function-in-jsx-prop
          onDismiss={(id: string) => fetch(`/api/notifications/${id}`, { method: 'DELETE' })}
          // VIOLATION: performance/deterministic/inline-object-in-jsx-prop
          style={{ padding: 16, margin: 8 }}
        />
        <UserSearch
          // VIOLATION: performance/deterministic/inline-function-in-jsx-prop
          onSearch={(query: string) => console.log('searching:', query)}
        />
      </div>
    </div>
  );
}

interface UserSearchProps {
  onSearch: (query: string) => void;
}

function UserSearch({ onSearch }: UserSearchProps) {
  const [query, setQuery] = useState('');

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <button onClick={() => onSearch(query)}>Search</button>
    </div>
  );
}
