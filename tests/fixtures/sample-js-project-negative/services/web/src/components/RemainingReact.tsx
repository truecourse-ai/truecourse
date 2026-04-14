/**
 * Remaining React patterns not covered elsewhere.
 */

import React, { useState, useEffect, useCallback } from 'react';

// VIOLATION: bugs/deterministic/useeffect-missing-deps
export function MissingDeps({ userId }: { userId: string }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch(`/api/users/${userId}`)
      .then((r) => r.json())
      .then(setData);
  }, []); // userId is missing from deps

  return <div>{JSON.stringify(data)}</div>;
}

// VIOLATION: code-quality/deterministic/html-table-accessibility
export function DataTable({ rows }: { rows: string[][] }) {
  return (
    <table>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// VIOLATION: security/deterministic/disabled-resource-integrity
export function ScriptTag() {
  return (
    <script src="https://cdn.example.com/lib.js" crossOrigin="anonymous" />
  );
}
