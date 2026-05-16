
// FP shape f9d9779aec02: JSX render of audit log rows with date formatting — no type mismatch
declare function formatDate(d: Date, opts: { locale?: string }): string;
declare const auditEntries: Array<{ id: string; action: string; performedAt: Date; performedBy?: string }>;
declare const userLocale: string | undefined;

function AuditLogTable() {
  return (
    <table>
      <tbody>
        {auditEntries.map((entry) => (
          <tr key={entry.id}>
            <td>{entry.action}</td>
            <td>{entry.performedBy ?? 'System'}</td>
            <td>{formatDate(entry.performedAt, { locale: userLocale })}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
