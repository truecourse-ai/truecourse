import * as React from 'react';

export function DataTable(): React.ReactElement {
  return (
    // VIOLATION: code-quality/deterministic/html-table-accessibility
    <table>
      <tbody>
        <tr>
          <td>1</td>
        </tr>
      </tbody>
    </table>
  );
}
