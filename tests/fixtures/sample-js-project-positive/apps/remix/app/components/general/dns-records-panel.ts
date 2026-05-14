
// FP: onClick={() => void onCopyToClipboard(record.value)} — intentional fire-and-forget
// promise discard in an event handler. Not a void 0 case.
declare function onCopyToClipboard(value: string): Promise<void>;
declare const React3: { createElement: (...args: unknown[]) => unknown };

type DnsRecord = { type: string; name: string; value: string };

function DnsRecordsPanel({ dnsRecords }: { dnsRecords: DnsRecord[] }) {
  return dnsRecords.map((record, index) =>
    React3.createElement('button', {
      key: index,
      onClick: () => void onCopyToClipboard(record.value),
    }, `Copy ${record.type} record`),
  );
}
