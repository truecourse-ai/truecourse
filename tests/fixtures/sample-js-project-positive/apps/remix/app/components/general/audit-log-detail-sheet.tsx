declare const logDetails: { header: string; value: string }[];

const AuditLogDetailSheet = () => {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-left text-sm">
        <tbody className="divide-y divide-border bg-muted/30">
          {logDetails.map(({ header, value }, index) => (
            <tr key={index}>
              <td className="w-1/3 border-border border-r px-4 py-2 font-mono text-muted-foreground text-xs">
                {header}
              </td>
              <td className="break-all px-4 py-2 font-mono text-foreground text-xs">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
