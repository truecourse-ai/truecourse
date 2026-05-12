export function ProperDeps(): JSX.Element { return <div>loaded</div>; }
export function AccessibleDataTable(): JSX.Element {
  return (<table><thead><tr><th>Data</th></tr></thead><tbody><tr><td>Row</td></tr></tbody></table>);
}
export function SvgIcon(): JSX.Element {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></svg>;
}



declare const React: any;

interface WebhookLogEntry {
  url: string;
  status: number;
  attempts: number;
  createdAt: string;
}

export function WebhookLogsSheet({ entry }: { entry: WebhookLogEntry }): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-medium">Webhook delivery</h3>
      <table className="w-full text-sm">
        <tbody>
          <tr>
            <td className="py-1 pr-4 font-mono text-muted-foreground">URL</td>
            <td className="py-1 break-all">{entry.url}</td>
          </tr>
          <tr>
            <td className="py-1 pr-4 font-mono text-muted-foreground">Status</td>
            <td className="py-1">{entry.status}</td>
          </tr>
          <tr>
            <td className="py-1 pr-4 font-mono text-muted-foreground">Attempts</td>
            <td className="py-1">{entry.attempts}</td>
          </tr>
          <tr>
            <td className="py-1 pr-4 font-mono text-muted-foreground">Created at</td>
            <td className="py-1">{entry.createdAt}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function ResponseHeadersTable({ headers }: { headers: Record<string, string> }): JSX.Element {
  const entries = Object.entries(headers);
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-xs uppercase tracking-wide text-muted-foreground">Response headers</h4>
      <table className="w-full font-mono text-xs">
        <tbody>
          {entries.map(([name, value]) => (
            <tr key={name}>
              <td className="py-0.5 pr-3 text-muted-foreground align-top">{name}</td>
              <td className="py-0.5 break-all">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type TablePrimitiveProps = React.HTMLAttributes<HTMLTableElement>;

export const TablePrimitive = React.forwardRef<HTMLTableElement, TablePrimitiveProps>(
  ({ className, ...props }: TablePrimitiveProps, ref: React.Ref<HTMLTableElement>) => (
    <div className="relative w-full overflow-auto">
      <table ref={ref} className={`w-full caption-bottom text-sm ${className ?? ''}`} {...props} />
    </div>
  ),
);
TablePrimitive.displayName = 'TablePrimitive';
