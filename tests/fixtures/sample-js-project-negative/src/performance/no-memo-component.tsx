/**
 * Performance violation: exported component without memoization.
 */

import React from 'react';

// VIOLATION: performance/deterministic/missing-react-memo
export default function UserCard({ name, email }: { name: string; email: string }) {
  return (
    <div className="card">
      <h2>{name}</h2>
      <p>{email}</p>
    </div>
  );
}
