
declare const sheetCall: { end: (value: null) => void };
declare function Sheet(props: { open: boolean; onOpenChange: (open: boolean) => void; children?: unknown }): unknown;

function ActivityLogSheet({ isOpen }: { isOpen: boolean }) {
  return Sheet({
    open: isOpen,
    onOpenChange: (value: boolean) => (!value ? sheetCall.end(null) : null),
  });
}



// --- argument-type-mismatch FP: Number(payload[0].value).toLocaleString conversion ---
declare const chartPayload: Array<{ name: string; value: string | number }>;

function formatChartValue(payload: typeof chartPayload): string {
  if (!payload || payload.length === 0) return '0';
  return Number(payload[0].value).toLocaleString('en-US');
}
