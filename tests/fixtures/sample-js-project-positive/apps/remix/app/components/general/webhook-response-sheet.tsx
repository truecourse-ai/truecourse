// Raw <table> used for key-value display of response headers in a developer-facing log sheet.
// No tabular data needing column headers; semantic th/caption not applicable here.
declare const responseHeaders: Record<string, string>;

function WebhookResponseHeaders() {
  return (
    <div className="font-mono text-sm">
      <table>
        <tbody>
          {Object.entries(responseHeaders).map(([key, value]) => (
            <tr key={key}>
              <td className="pr-4 text-muted-foreground">{key}</td>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
